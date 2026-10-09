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
import { readFileSync } from 'node:fs';
const ffmpegSource = readFileSync(new URL('../src/ffmpeg.js', import.meta.url), 'utf8');
assert.ok(ffmpegSource.includes("'-c:v', 'libx264'"), 'WebM videos must be encoded for MP4 output.');
assert.ok(!ffmpegSource.includes("'-c:v', 'copy'"), 'VP8/VP9 cannot be stream-copied into MP4.');
console.log('Pruebas de filtros de audio y MP4 compatible: OK');

// Guards for the Vite /public import error shown in Windows.
import { readFileSync as read } from 'node:fs';
const fsrc = read(new URL('../src/ffmpeg.js', import.meta.url), 'utf8');
const preload = read(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const main = read(new URL('../electron/main.cjs', import.meta.url), 'utf8');
assert.ok(fsrc.includes("toBlobURL"), 'FFmpeg core JS/WASM must be loaded as Blob URLs.');
assert.ok(fsrc.includes("readBundled(name)"), 'Packaged Electron must have a secured local-asset fallback.');
assert.ok(preload.includes("ffmpeg:read-core-asset"), 'Preload bridge must expose FFmpeg assets.');
assert.ok(main.includes("FFMPEG_CORE_ASSETS.has(name)"), 'IPC must allowlist asset names.');
assert.ok(fsrc.includes("return 0;"), 'Successful FFmpeg filter execution must return success.');
