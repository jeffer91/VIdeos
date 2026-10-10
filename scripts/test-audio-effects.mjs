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

const smoke = read(new URL('../src/audioSmokeTest.js', import.meta.url), 'utf8');
assert.ok(smoke.includes('await enhanceMediaAudio('));
assert.ok(smoke.includes('await createAudioComparison('));
assert.ok(smoke.includes('await cutMedia('));

// The video renderers must never import FFmpeg assets directly from /public.
const coreLoader = read(new URL('../src/ffmpegCoreAssets.js', import.meta.url), 'utf8');
const production = read(new URL('../src/productionRenderer.js', import.meta.url), 'utf8');
const final = read(new URL('../src/finalRenderer.js', import.meta.url), 'utf8');
assert.ok(coreLoader.includes('toBlobURL('), 'El núcleo FFmpeg debe convertirse a URL Blob.');
assert.ok(coreLoader.includes('readBundled(name)'), 'La versión instalada debe usar el fallback seguro.');
for (const [name, source] of [['Unión', production], ['Resultado', final]]) {
  assert.ok(source.includes('await loadFFmpegCore(ffmpegInstance)'), `${name} debe cargar FFmpeg con rutas correctas.`);
  assert.ok(!source.includes('wasmURL: `${base}ffmpeg-core.wasm`'), `${name} no debe usar rutas directas de /public.`);
}
assert.ok(smoke.includes('await verifyProductionRendererCore()'), 'La prueba Windows debe cargar el compositor.');
assert.ok(smoke.includes('await verifyFinalRendererCore()'), 'La prueba Windows debe cargar el renderizador final.');

const native = read(new URL('../electron/native-ffmpeg.cjs', import.meta.url), 'utf8');
const fallback = read(new URL('../src/engineFallback.js', import.meta.url), 'utf8');
const productionAudit = read(new URL('../src/productionRenderer.js', import.meta.url), 'utf8');
const finalAudit = read(new URL('../src/finalRenderer.js', import.meta.url), 'utf8');
const studio = read(new URL('../src/ProductionApp.jsx', import.meta.url), 'utf8');
assert.ok(native.includes("ipcMain.handle('native-ffmpeg:cancel'"), 'El motor nativo debe admitir cancelación.');
assert.ok(native.includes("ipcMain.handle('native-ffmpeg:exec'"), 'El motor nativo debe procesar archivos.');
assert.ok(native.includes("safeFilename(name)"), 'Los nombres temporales deben validarse.');
assert.ok(fallback.includes('await engine?.close?.()'), 'El motor alternativo debe limpiar sesiones.');
assert.ok(fallback.includes("engine?.off?.('progress'"), 'Evitar fugas de listeners de progreso.');
assert.ok(productionAudit.includes('withEngineFallback('), 'El render completo debe usar dos motores.');
assert.ok(finalAudit.includes('withEngineFallback('), 'El render alternativo debe usar dos motores.');
assert.ok(studio.includes('ProcessingOptionsPanel'), 'El usuario debe poder elegir el motor.');
assert.ok(smoke.includes("method: 'native', fallback: false"), 'La prueba real debe forzar el motor nativo.');
assert.ok(smoke.includes("method: 'wasm', fallback: false"), 'La prueba real debe forzar WASM.');
