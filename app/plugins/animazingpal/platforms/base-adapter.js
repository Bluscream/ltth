class BaseAvatarAdapter {
  constructor(api, config = {}) {
    this.api = api;
    this.config = config || {};
    this.isConnected = false;
    this.data = this.getInitialData();
  }

  setConfig(config = {}) {
    this.config = config || {};
  }

  getKey() {
    return 'base';
  }

  getLabel() {
    return 'Base';
  }

  getInitialData() {
    return {};
  }

  getCapabilities() {
    return {
      connection: false,
      chat: false,
      actions: [],
      dataSets: []
    };
  }

  getData() {
    return this.data || this.getInitialData();
  }

  setData(partialData) {
    this.data = {
      ...this.getInitialData(),
      ...partialData
    };
    return this.data;
  }

  can(actionType) {
    return this.getCapabilities().actions.includes(actionType);
  }

  log(level, message) {
    if (this.api && typeof this.api.log === 'function') {
      this.api.log(`[${this.getLabel()}] ${message}`, level);
    }
  }

  async connect() {
    this.isConnected = true;
    return true;
  }

  disconnect() {
    this.isConnected = false;
    return true;
  }

  async refreshData() {
    return this.getData();
  }

  async executeAction() {
    return false;
  }

  async loadAvatar() {
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
}

module.exports = BaseAvatarAdapter;
