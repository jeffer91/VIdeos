import assert from 'node:assert/strict';
import {
  DEFAULT_AUDIO_EFFECTS, normalizeAudioEffects, hasAudioEffects, audioFilterChain,
} from '../src/audioEffects.js';

assert.deepEqual(DEFAULT_AUDIO_EFFECTS, { noiseReduction: false, voiceEnhancement: false });
assert.equal(hasAudioEffects(DEFAULT_AUDIO_EFFECTS), false);
assert.equal(audioFilterChain(DEFAULT_AUDIO_EFFECTS), '');
assert.deepEqual(normalizeAudioEffects({ noiseReduction: 1, voiceEnhancement: 'yes' }), DEFAULT_AUDIO_EFFECTS);

const noiseOnly = { noiseReduction: true, voiceEnhancement: false };
const voiceOnly = { noiseReduction: false, voiceEnhancement: true };
assert.ok(audioFilterChain(noiseOnly).includes('afftdn='));
assert.ok(!audioFilterChain(noiseOnly).includes('loudnorm='));
assert.ok(audioFilterChain(voiceOnly).includes('loudnorm='));
assert.ok(!audioFilterChain(voiceOnly).includes('afftdn='));
const both = audioFilterChain({ noiseReduction: true, voiceEnhancement: true });
assert.ok(both.indexOf('afftdn=') < both.indexOf('loudnorm='));
assert.ok(hasAudioEffects(noiseOnly));
assert.ok(hasAudioEffects(voiceOnly));
console.log('Pruebas de filtros de audio: desactivados, independientes y combinados OK');
