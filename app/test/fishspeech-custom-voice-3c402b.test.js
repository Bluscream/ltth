/**
 * Test suite for fish-custom-voice-3c402b voice entry
 * Verifies that the new custom voice is properly added to Fish.audio engine
 */

const assert = require('assert');
const FishSpeechEngine = require('../plugins/tts/engines/fishspeech-engine');

console.log('🧪 Testing fish-custom-voice-3c402b voice entry...\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (error) {
        console.error(`✗ ${name}`);
        console.error(`  Error: ${error.message}`);
        failed++;
    }
}

// Test 1: Verify fish-custom-voice-3c402b exists in voices
runTest('fish-custom-voice-3c402b should exist in getVoices()', () => {
    const voices = FishSpeechEngine.getVoices();
    assert(voices['fish-custom-voice-3c402b'], 'Voice fish-custom-voice-3c402b should exist');
});

// Test 2: Verify voice properties are correct
runTest('fish-custom-voice-3c402b should have correct properties', () => {
    const voices = FishSpeechEngine.getVoices();
    const voice = voices['fish-custom-voice-3c402b'];
    
    assert.strictEqual(voice.name, 'Custom Voice 3c402b', 'Voice name should be "Custom Voice 3c402b"');
    assert.strictEqual(voice.lang, 'de', 'Voice language should be "de"');
    assert.strictEqual(voice.gender, 'male', 'Voice gender should be "male"');
    assert.strictEqual(voice.model, 's1', 'Voice model should be "s1"');
    assert.strictEqual(voice.reference_id, '3c402b86cb174f3484803941880414fc', 'Voice reference_id should match');
    assert.strictEqual(voice.description, 'Custom fish 1', 'Voice description should be "Custom fish 1"');
    assert.strictEqual(voice.supportedEmotions, true, 'Voice should support emotions');
});

// Test 3: Verify voice uses Fish Audio S1 model
runTest('fish-custom-voice-3c402b should use Fish Audio S1 model', () => {
    const voices = FishSpeechEngine.getVoices();
    const voice = voices['fish-custom-voice-3c402b'];
    
    assert.strictEqual(voice.model, 's1', 'Voice should use s1 model');
});

// Test 4: Verify emotion support is enabled
runTest('fish-custom-voice-3c402b should have emotion support enabled', () => {
    const voices = FishSpeechEngine.getVoices();
    const voice = voices['fish-custom-voice-3c402b'];
    
    assert.strictEqual(voice.supportedEmotions, true, 'Emotion support should be enabled');
});

// Summary
console.log(`\n📊 Test Results:`);
console.log(`   Passed: ${passed}`);
console.log(`   Failed: ${failed}`);

if (failed > 0) {
    console.error('\n❌ Some tests failed!');
    process.exit(1);
} else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
}
