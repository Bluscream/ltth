const WebSocket = require('ws');
const BaseAvatarAdapter = require('./base-adapter');

class VTubeStudioAdapter extends BaseAvatarAdapter {
  constructor(api, config = {}) {
    super(api, config);
    this.ws = null;
    this.pendingRequests = new Map();
    this.requestCounter = 0;
    this.authenticated = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  getKey() {
    return 'vtube-studio';
  }

  getLabel() {
    return 'VTube Studio';
  }

  getInitialData() {
    return {
      hotkeys: [],
      availableModels: [],
      currentModel: null
    };
  }

  getCapabilities() {
    return {
      connection: true,
      chat: false,
      actions: ['hotkey', 'loadAvatar'],
      dataSets: ['hotkeys', 'availableModels', 'currentModel']
    };
  }

  get host() {
    return this.config.host || '127.0.0.1';
  }

  get port() {
    return parseInt(this.config.port, 10) || 8001;
  }

  get pluginName() {
    return this.config.pluginName || 'AnimazingPal';
  }

  get pluginDeveloper() {
    return this.config.pluginDeveloper || 'LTTH';
  }

  get authToken() {
    return this.config.authToken || '';
  }

  set authToken(value) {
    this.config.authToken = value || '';
    if (this.api && typeof this.api.setConfig === 'function' && this.api.getConfig) {
      try {
        const current = this.api.getConfig('config') || {};
        if (current.platform?.profiles?.['vtube-studio']) {
          current.platform.profiles['vtube-studio'].authToken = this.config.authToken;
          this.api.setConfig('config', current);
        }
      } catch (error) {
        this.log('warn', `Failed to persist auth token: ${error.message}`);
      }
    }
  }

  async connect() {
    if (this.isConnected) {
      return true;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        this.log('debug', `Error closing existing socket: ${error.message}`);
      }
      this.ws = null;
    }

    const url = `ws://${this.host}:${this.port}`;
    this.log('info', `Connecting to ${url}...`);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      try {
        this.ws = new WebSocket(url, {
          handshakeTimeout: 5000
        });

        this.ws.on('open', async () => {
          try {
            const authenticated = await this._authenticate();
            if (!authenticated) {
              finish(false);
              return;
            }

            this.isConnected = true;
            this.authenticated = true;
            this.reconnectAttempts = 0;
            await this.refreshData();
            this.log('info', 'Connected to VTube Studio successfully');
            finish(true);
          } catch (error) {
            this.log('error', `VTube Studio authentication failed: ${error.message}`);
            finish(false);
          }
        });

        this.ws.on('message', (data) => {
          this._handleMessage(data);
        });

        this.ws.on('close', () => {
          this.isConnected = false;
          this.authenticated = false;
          this._clearPendingRequests();
          this.log('info', 'Disconnected from VTube Studio');
          if (this.config.reconnectOnDisconnect && this.config.enabled) {
            this._scheduleReconnect();
          }
        });

        this.ws.on('error', (error) => {
          this.log('error', `VTube Studio WebSocket error: ${error.message}`);
          this.isConnected = false;
          finish(false);
        });

        setTimeout(() => {
          if (!settled && !this.isConnected) {
            try {
              if (this.ws) {
                this.ws.close();
              }
            } catch (error) {
              this.log('debug', `Timeout close failed: ${error.message}`);
            }
            finish(false);
          }
        }, 10000);
      } catch (error) {
        this.log('error', `Failed to connect to VTube Studio: ${error.message}`);
        finish(false);
      }
    });
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        this.log('debug', `Close error: ${error.message}`);
      }
      this.ws = null;
    }

    this.isConnected = false;
    this.authenticated = false;
    this._clearPendingRequests();
    this.log('info', 'Disconnected from VTube Studio');
    return true;
  }

  async refreshData() {
    if (!this.isConnected) {
      return this.getData();
    }

    const [hotkeysResponse, currentModelResponse, availableModelsResponse] = await Promise.all([
      this.request('HotkeysInCurrentModelRequest'),
      this.request('CurrentModelRequest'),
      this.request('AvailableModelsRequest')
    ]);

    const hotkeys = this._extractHotkeys(hotkeysResponse);
    const currentModel = currentModelResponse?.data || null;
    const availableModels = availableModelsResponse?.data?.availableModels || [];

    this.setData({
      hotkeys,
      currentModel,
      availableModels
    });

    return this.getData();
  }

  async executeAction(actionType, actionValue) {
    if (!this.isConnected) {
      return false;
    }

    if (!actionValue && actionValue !== 0) {
      return false;
    }

    if (actionType === 'loadAvatar') {
      return this.loadAvatar(actionValue);
    }

    if (actionType !== 'hotkey') {
      return this.executeAction('hotkey', actionValue);
    }

    const response = await this.request('HotkeyTriggerRequest', {
      hotkeyID: String(actionValue)
    });

    return !!(response && !response.error);
  }

  async loadAvatar(name) {
    if (!this.isConnected) {
      return false;
    }

    const available = this.data.availableModels || [];
    const match = available.find(model => {
      return model.modelID === name || model.modelName === name || model.vtsModelName === name;
    });

    if (!match) {
      this.log('warn', `Model not found: ${name}`);
      return false;
    }

    const response = await this.request('ModelLoadRequest', {
      modelID: match.modelID
    });

    if (response && !response.error) {
      await this.refreshData();
      return true;
    }

    return false;
  }

  async loadScene() {
    return false;
  }

  async sendChatMessage() {
    return false;
  }

  async setOverride() {
    return false;
  }

  async getOverride() {
    return null;
  }

  async calibrateTracker() {
    return false;
  }

  async setBroadcast() {
    return false;
  }

  getActionOptions() {
    return (this.data.hotkeys || []).map((hotkey) => ({
      value: hotkey.hotkeyID || hotkey.name || hotkey.hotkeyName || '',
      label: hotkey.name || hotkey.hotkeyName || hotkey.description || hotkey.hotkeyID || 'Hotkey'
    })).filter(option => option.value);
  }

  async request(messageType, data = {}, timeoutMs = 10000) {
    if (!this.ws || !this.isConnected && messageType !== 'AuthenticationTokenRequest' && messageType !== 'AuthenticationRequest') {
      return null;
    }

    const requestID = this._nextRequestId();
    const payload = {
      apiName: 'VTubeStudioPublicAPI',
      apiVersion: '1.0',
      requestID,
      messageType
    };

    if (data && Object.keys(data).length > 0) {
      payload.data = data;
    }

    const message = JSON.stringify(payload);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestID);
        resolve(null);
      }, timeoutMs);

      this.pendingRequests.set(requestID, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        }
      });

      try {
        this.ws.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestID);
        this.log('error', `Failed to send ${messageType}: ${error.message}`);
        resolve(null);
      }
    });
  }

  async _authenticate() {
    const token = this.authToken;
    if (!token) {
      const tokenResponse = await this.request('AuthenticationTokenRequest', {
        pluginName: this.pluginName,
        pluginDeveloper: this.pluginDeveloper
      });

      const newToken = tokenResponse?.data?.authenticationToken;
      if (!newToken) {
        return false;
      }

      this.authToken = newToken;
    }

    const authResponse = await this.request('AuthenticationRequest', {
      pluginName: this.pluginName,
      pluginDeveloper: this.pluginDeveloper,
      authenticationToken: this.authToken
    });

    return !!(authResponse?.data?.authenticated);
  }

  _handleMessage(rawData) {
    try {
      const message = JSON.parse(rawData.toString());

      if (message.requestID && this.pendingRequests.has(message.requestID)) {
        const pending = this.pendingRequests.get(message.requestID);
        this.pendingRequests.delete(message.requestID);
        pending.resolve(message);
        return;
      }

      if (message.messageType === 'AuthenticationTokenResponse' && message.data?.authenticationToken) {
        this.authToken = message.data.authenticationToken;
      }

      if (message.messageType === 'CurrentModelResponse' && message.data) {
        this.data.currentModel = message.data;
      }

      if (message.messageType === 'AvailableModelsResponse' && message.data?.availableModels) {
        this.data.availableModels = message.data.availableModels;
      }

      if (message.messageType === 'HotkeysInCurrentModelResponse') {
        this.data.hotkeys = this._extractHotkeys(message);
      }
    } catch (error) {
      this.log('warn', `Failed to parse VTube Studio message: ${error.message}`);
    }
  }

  _extractHotkeys(response) {
    const hotkeys = response?.data?.availableHotkeys || response?.data?.hotkeys || [];
    return Array.isArray(hotkeys) ? hotkeys : [];
  }

  _nextRequestId() {
    this.requestCounter += 1;
    return `vts_${this.requestCounter}_${Date.now()}`;
  }

  _clearPendingRequests() {
    for (const [requestID, pending] of this.pendingRequests.entries()) {
      try {
        pending.resolve(null);
      } catch (error) {
        this.log('debug', `Pending resolve failed for ${requestID}: ${error.message}`);
      }
    }
    this.pendingRequests.clear();
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || !this.config.reconnectOnDisconnect) {
      return;
    }

    const delay = Math.max(1000, Number(this.config.reconnectDelay) || 5000);
    if (this.reconnectAttempts >= (Number(this.config.maxReconnectAttempts) || 10)) {
      this.log('warn', 'Max reconnect attempts reached for VTube Studio');
      return;
    }

    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connect();
    }, delay);
  }
}

module.exports = VTubeStudioAdapter;
