const osc = require('osc');
const BaseAvatarAdapter = require('./base-adapter');

const BLENDSHAPES = {
  joy: 'Joy',
  angry: 'Angry',
  sorrow: 'Sorrow',
  fun: 'Fun',
  a: 'A',
  i: 'I',
  u: 'U',
  e: 'E',
  o: 'O',
  blink_left: 'Blink_L',
  blink_right: 'Blink_R'
};

const MOTION_PRESETS = {
  idle: 'idle',
  wave: 'wave',
  nod: 'nod',
  shake: 'shake',
  tilt_left: 'tilt_left',
  tilt_right: 'tilt_right',
  bounce: 'bounce'
};

class VSeeFaceAdapter extends BaseAvatarAdapter {
  constructor(api, config = {}) {
    super(api, config);
    this.port = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  getKey() {
    return 'vseeface';
  }

  getLabel() {
    return 'VSeeFace';
  }

  getInitialData() {
    return {
      expressions: Object.values(BLENDSHAPES),
      motions: Object.values(MOTION_PRESETS),
      currentExpression: null,
      currentMotion: null
    };
  }

  getCapabilities() {
    return {
      connection: true,
      chat: false,
      actions: ['expression', 'motion', 'reset'],
      dataSets: ['expressions', 'motions']
    };
  }

  get host() {
    return this.config.host || '127.0.0.1';
  }

  get portNumber() {
    return parseInt(this.config.port, 10) || 39539;
  }

  async connect() {
    if (this.isConnected) {
      return true;
    }

    if (this.port) {
      try {
        this.port.close();
      } catch (error) {
        this.log('debug', `Error closing UDP port: ${error.message}`);
      }
      this.port = null;
    }

    this.log('info', `Connecting to VSeeFace VMC at ${this.host}:${this.portNumber}...`);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };

      try {
        this.port = new osc.UDPPort({
          localAddress: '0.0.0.0',
          localPort: 0,
          remoteAddress: this.host,
          remotePort: this.portNumber,
          metadata: true
        });

        this.port.on('ready', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.log('info', 'Connected to VSeeFace successfully');
          finish(true);
        });

        this.port.on('error', (error) => {
          this.isConnected = false;
          this.log('error', `VSeeFace OSC error: ${error.message}`);
          finish(false);
        });

        this.port.open();

        setTimeout(() => {
          if (!settled && !this.isConnected) {
            try {
              if (this.port) {
                this.port.close();
              }
            } catch (error) {
              this.log('debug', `Timeout close failed: ${error.message}`);
            }
            finish(false);
          }
        }, 7000);
      } catch (error) {
        this.log('error', `Failed to connect to VSeeFace: ${error.message}`);
        finish(false);
      }
    });
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.port) {
      try {
        this.port.close();
      } catch (error) {
        this.log('debug', `Close error: ${error.message}`);
      }
      this.port = null;
    }

    this.isConnected = false;
    this.log('info', 'Disconnected from VSeeFace');
    return true;
  }

  async refreshData() {
    return this.getData();
  }

  async executeAction(actionType, actionValue) {
    if (!this.isConnected || !this.port) {
      return false;
    }

    switch (actionType) {
      case 'expression':
      case 'emote':
        return this._sendExpression(actionValue);
      case 'motion':
      case 'pose':
        return this._sendMotion(actionValue);
      case 'reset':
      case 'idle':
        return this._sendReset();
      default:
        return false;
    }
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

  getActionOptions(actionType = 'expression') {
    if (actionType === 'motion') {
      return Object.values(MOTION_PRESETS).map((name) => ({
        value: name,
        label: name
      }));
    }

    return Object.values(BLENDSHAPES).map((name) => ({
      value: name,
      label: name
    }));
  }

  _sendExpression(value) {
    const expression = this._normalizeBlendshape(value);
    if (!expression) {
      return false;
    }

    this._sendOsc('/VMC/Ext/Blend/Val', [
      { type: 's', value: expression },
      { type: 'f', value: 1.0 }
    ]);
    this._sendOsc('/VMC/Ext/Blend/Apply', []);
    this.setData({
      currentExpression: expression
    });
    return true;
  }

  _sendMotion(value) {
    const motion = this._normalizeMotion(value);
    if (!motion) {
      return false;
    }

    const presets = this._buildMotionPreset(motion);
    presets.forEach((packet) => this._sendOsc(packet.address, packet.args));

    this._sendOsc('/VMC/Ext/Blend/Apply', []);
    this.setData({
      currentMotion: motion
    });
    return true;
  }

  _sendReset() {
    Object.values(BLENDSHAPES).forEach((name) => {
      this._sendOsc('/VMC/Ext/Blend/Val', [
        { type: 's', value: name },
        { type: 'f', value: 0.0 }
      ]);
    });

    this._sendOsc('/VMC/Ext/Blend/Apply', []);
    this.setData({
      currentExpression: null,
      currentMotion: 'idle'
    });
    return true;
  }

  _sendOsc(address, args = []) {
    if (!this.port) {
      return false;
    }

    try {
      this.port.send({
        address,
        args
      });
      return true;
    } catch (error) {
      this.log('error', `Failed to send OSC packet ${address}: ${error.message}`);
      return false;
    }
  }

  _normalizeBlendshape(value) {
    if (!value && value !== 0) {
      return null;
    }

    const lowered = String(value).trim().toLowerCase();
    if (BLENDSHAPES[lowered]) {
      return BLENDSHAPES[lowered];
    }

    const match = Object.values(BLENDSHAPES).find((name) => name.toLowerCase() === lowered);
    return match || String(value).trim();
  }

  _normalizeMotion(value) {
    if (!value && value !== 0) {
      return null;
    }

    const lowered = String(value).trim().toLowerCase();
    if (MOTION_PRESETS[lowered]) {
      return MOTION_PRESETS[lowered];
    }

    const match = Object.values(MOTION_PRESETS).find((name) => name.toLowerCase() === lowered);
    return match || String(value).trim().toLowerCase();
  }

  _buildMotionPreset(motion) {
    const neutral = this._bonePacket('Head', 0, 0, 0, 0, 0, 0, 1);

    switch (motion) {
      case 'wave':
        return [
          neutral,
          this._bonePacket('RightUpperArm', 0, 0, 0, 0.15, -0.45, 0.20, 0.86),
          this._bonePacket('RightLowerArm', 0, 0, 0, 0.35, -0.10, 0.10, 0.92),
          this._bonePacket('RightHand', 0, 0, 0, 0.00, 0.00, 0.15, 0.99)
        ];
      case 'nod':
        return [
          this._bonePacket('Head', 0, 0, 0, 0.20, 0.00, 0.00, 0.98),
          this._bonePacket('Neck', 0, 0, 0, 0.08, 0.00, 0.00, 0.99)
        ];
      case 'shake':
        return [
          this._bonePacket('Head', 0, 0, 0, 0.00, 0.18, 0.00, 0.98),
          this._bonePacket('Neck', 0, 0, 0, 0.00, -0.08, 0.00, 0.99)
        ];
      case 'tilt_left':
        return [
          this._bonePacket('Head', 0, 0, 0, 0.00, 0.00, 0.16, 0.99),
          this._bonePacket('Neck', 0, 0, 0, 0.00, 0.00, 0.08, 0.99)
        ];
      case 'tilt_right':
        return [
          this._bonePacket('Head', 0, 0, 0, 0.00, 0.00, -0.16, 0.99),
          this._bonePacket('Neck', 0, 0, 0, 0.00, 0.00, -0.08, 0.99)
        ];
      case 'bounce':
        return [
          this._bonePacket('Hips', 0, 0.04, 0, 0.00, 0.00, 0.00, 1.00),
          this._bonePacket('Chest', 0, 0.01, 0, 0.05, 0.00, 0.00, 0.99)
        ];
      case 'idle':
      default:
        return [neutral];
    }
  }

  _bonePacket(name, px, py, pz, qx, qy, qz, qw) {
    return {
      address: '/VMC/Ext/Bone/Pos',
      args: [
        { type: 's', value: name },
        { type: 'f', value: px },
        { type: 'f', value: py },
        { type: 'f', value: pz },
        { type: 'f', value: qx },
        { type: 'f', value: qy },
        { type: 'f', value: qz },
        { type: 'f', value: qw }
      ]
    };
  }
}

module.exports = VSeeFaceAdapter;
