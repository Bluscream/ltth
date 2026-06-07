const assert = require('assert');
const VTubeStudioAdapter = require('../plugins/animazingpal/platforms/vtube-studio');
const VSeeFaceAdapter = require('../plugins/animazingpal/platforms/vseeface');

function createApiStub() {
  return {
    log() {},
    getConfig() {
      return null;
    },
    setConfig() {}
  };
}

describe('AnimazingPal Platform Adapters', function() {
  it('triggers VTube Studio hotkeys and loads models', async function() {
    const requests = [];
    const adapter = new VTubeStudioAdapter(createApiStub(), {
      host: '127.0.0.1',
      port: 8001
    });

    adapter.isConnected = true;
    adapter.data.availableModels = [
      { modelID: 'model-a', modelName: 'Model A' }
    ];
    adapter.request = async (messageType, payload = {}) => {
      requests.push({ messageType, payload });
      return { data: { availableModels: adapter.data.availableModels } };
    };

    const hotkeyResult = await adapter.executeAction('hotkey', 'hotkey-123');
    const modelResult = await adapter.executeAction('loadAvatar', 'model-a');

    assert.strictEqual(hotkeyResult, true, 'Hotkey trigger should succeed');
    assert.strictEqual(modelResult, true, 'Model load should succeed');
    assert.strictEqual(requests[0].messageType, 'HotkeyTriggerRequest');
    assert.deepStrictEqual(requests[0].payload, { hotkeyID: 'hotkey-123' });
    assert.strictEqual(requests[1].messageType, 'ModelLoadRequest');
    assert.deepStrictEqual(requests[1].payload, { modelID: 'model-a' });
  });

  it('sends VSeeFace motion and reset OSC packets', async function() {
    const packets = [];
    const adapter = new VSeeFaceAdapter(createApiStub(), {
      host: '127.0.0.1',
      port: 39539
    });

    adapter.isConnected = true;
    adapter.port = {
      send(packet) {
        packets.push(packet);
      }
    };

    const motionResult = await adapter.executeAction('motion', 'wave');
    const resetResult = await adapter.executeAction('reset', 'reset');

    assert.strictEqual(motionResult, true, 'Motion trigger should succeed');
    assert.strictEqual(resetResult, true, 'Reset should succeed');
    assert.ok(packets.some((packet) => packet.address === '/VMC/Ext/Bone/Pos'), 'Should send bone position packets');
    assert.ok(packets.some((packet) => packet.address === '/VMC/Ext/Blend/Apply'), 'Should apply blendshape updates');
  });
});
