const BaseAvatarAdapter = require('./base-adapter');
const VTubeStudioAdapter = require('./vtube-studio');
const VSeeFaceAdapter = require('./vseeface');

const PLATFORM_DEFINITIONS = {
  animaze: {
    key: 'animaze',
    label: 'Animaze',
    description: 'Legacy Animaze WebSocket integration',
    supported: true,
    connection: true,
    chat: true,
    actions: ['emote', 'specialAction', 'pose', 'idle']
  },
  'vtube-studio': {
    key: 'vtube-studio',
    label: 'VTube Studio',
    description: 'WebSocket hotkey integration for Live2D models',
    supported: true,
    connection: true,
    chat: false,
    actions: ['hotkey', 'loadAvatar']
  },
  vseeface: {
    key: 'vseeface',
    label: 'VSeeFace',
    description: 'VMC/OSC motion and expression integration for VRM avatars',
    supported: true,
    connection: true,
    chat: false,
    actions: ['expression', 'motion', 'reset']
  }
};

function createPlatformAdapter(platformKey, api, config = {}) {
  switch (platformKey) {
    case 'vtube-studio':
      return new VTubeStudioAdapter(api, config);
    case 'vseeface':
      return new VSeeFaceAdapter(api, config);
    default:
      return null;
  }
}

function getPlatformDefinition(platformKey) {
  return PLATFORM_DEFINITIONS[platformKey] || PLATFORM_DEFINITIONS.animaze;
}

function listPlatformDefinitions() {
  return Object.values(PLATFORM_DEFINITIONS);
}

module.exports = {
  BaseAvatarAdapter,
  createPlatformAdapter,
  getPlatformDefinition,
  listPlatformDefinitions,
  PLATFORM_DEFINITIONS
};
