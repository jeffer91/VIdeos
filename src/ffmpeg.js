import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { audioFilterChain, hasAudioEffects } from './audioEffects';
import { withEngineFallback } from './engineFallback';

let ffmpegInstance = null;
let loadingPromise = null;
let progressListenerBound = false;
let progressCallback = null;
let recentLogs = [];
let runCounter = 0;
const coreBlobUrls = [];

async function coreAssetUrl(name, contentType) {
  // Vite /public assets must be fetched as bytes, never dynamically imported.
  // An object URL also makes worker imports independent of Vite's /public transform.
  const local = new URL(`${import.meta.env.BASE_URL}ffmpeg/${name}`, document.baseURI).href;
  try {
    return await toBlobURL(local, contentType);
  } catch (fetchError) {
    // Chromium does not reliably allow fetch(file://...) in packaged Electron.
    // The strictly allowlisted preload API reads only our bundled core assets.
    const readBundled = window.videosStudio?.ffmpeg?.readCoreAsset;
    if (!readBundled) throw new Error(`No se pudo cargar ${name}. Revisa la instalación de FFmpeg. ${fetchError.message}`);
    const bytes = await readBundled(name);
    if (!bytes?.byteLength) throw new Error(`El archivo ${name} está vacío o no existe.`);
    return URL.createObjectURL(new Blob([bytes], { type: contentType }));
  }
}

function explainFFmpegError(context, error) {
  const last = recentLogs.filter((line) => /Error|No such|Unknown|Invalid|Failed|not found|unrecognized|unsupported/i.test(line)).slice(-3).join(' · ');
  const detail = [error?.message, last].filter(Boolean).join(' · ');
  return new Error(`${context}. ${detail || 'El motor no proporcionó detalles.'}`);
}

async function getFFmpeg() {
  if (!ffmpegInstance) ffmpegInstance = new FFmpeg();
  if (ffmpegInstance.loaded) return ffmpegInstance;

  if (!loadingPromise) {
    loadingPromise = (async () => {
      const ffmpeg = ffmpegInstance;
      if (!progressListenerBound) {
        ffmpeg.on('progress', ({ progress }) => {
          if (progressCallback) {
            const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
            progressCallback(safeProgress);
          }
        });
        progressListenerBound = true;
      }

      ffmpeg.on('log', ({ message }) => {
        recentLogs = [...recentLogs.slice(-35), String(message || '')];
      });
      recentLogs = [];
      const urls = await Promise.all([
        coreAssetUrl('ffmpeg-core.js', 'text/javascript'),
        coreAssetUrl('ffmpeg-core.wasm', 'application/wasm'),
      ]);
      coreBlobUrls.push(...urls);
      try {
        await ffmpeg.load({ coreURL: urls[0], wasmURL: urls[1] });
        return ffmpeg;
      } catch (error) {
        ffmpegInstance = null;
        progressListenerBound = false;
        throw explainFFmpegError('No se pudo iniciar el motor de audio FFmpeg', error);
      } finally {
        // Worker has already loaded these assets; they need not stay allocated.
        coreBlobUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
      }
    })();
  }

  try {
    return await loadingPromise;
  } catch (error) {
    ffmpegInstance = null;
    progressListenerBound = false;
    throw error;
  } finally {
    loadingPromise = null;
  }
}

function extensionFromMime(mimeType = '') {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

async function safeDelete(ffmpeg, path) {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // Best-effort cleanup of FFmpeg's in-memory filesystem.
  }
}

function outputNameFor(kind) {
  return `${kind}-${Date.now()}-${++runCounter}`;
}

async function runWithAudioFallback(ffmpeg, args, effects = {}, label = 'procesar audio') {
  recentLogs = [];
  let result = await ffmpeg.exec(args);
  if (result === 0) return 0;
  if (!hasAudioEffects(effects)) throw explainFFmpegError(`No se pudo ${label}`);
  // Some wasm builds omit afftdn/loudnorm. Use built-in EQ rather than fail
  // and never claim the full quality treatment was applied silently.
  const safe = audioFilterChain(effects, { compatible: true });
  const advanced = audioFilterChain(effects);
  if (!safe || safe === advanced) throw explainFFmpegError(`No se pudo ${label}`);
  const index = args.findIndex((arg) => arg === '-af' || arg === '-filter_complex');
  if (index < 0) throw explainFFmpegError(`No se pudo ${label}`);
  const retry = [...args];
  retry[index + 1] = String(retry[index + 1]).replace(advanced, safe);
  if (retry[index + 1] === args[index + 1]) throw explainFFmpegError(`No se pudo ${label}`);
  recentLogs = [];
  result = await ffmpeg.exec(['-y', ...retry]);
  if (result !== 0) throw explainFFmpegError(`No se pudo ${label} ni con filtros compatibles`);
  return 0;
}

function normalizeRanges(ranges = [], start, end) {
  const safe = ranges
    .map((range) => ({
      start: Math.max(start, Number(range?.start) || 0),
      end: Math.min(end, Number(range?.end) || 0),
    }))
    .filter((range) => range.end - range.start >= 0.03)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const range of safe) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 0.01) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function keepRanges(start, end, removedRanges) {
  const removed = normalizeRanges(removedRanges, start, end);
  const keep = [];
  let cursor = start;
  for (const range of removed) {
    if (range.start - cursor >= 0.03) keep.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (end - cursor >= 0.03) keep.push({ start: cursor, end });
  return keep;
}

async function runSingleRange(ffmpeg, inputName, outputName, mode, range, audioEffects = {}) {
  const audioChain = audioFilterChain(audioEffects);
  const duration = range.end - range.start;
  const args = mode === 'video'
    ? [
        '-ss', String(range.start),
        '-i', inputName,
        '-t', String(duration),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '21',
        '-pix_fmt', 'yuv420p',
        ...(audioChain ? ['-af', audioChain] : []),
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputName,
      ]
    : [
        '-ss', String(range.start),
        '-i', inputName,
        '-t', String(duration),
        '-vn',
        ...(audioChain ? ['-af', audioChain] : []),
        '-c:a', 'aac',
        '-b:a', '128k',
        outputName,
      ];
  return runWithAudioFallback(ffmpeg, args, audioEffects, 'recortar la grabación');
}

async function runMultipleRanges(ffmpeg, inputName, outputName, mode, ranges, audioEffects = {}) {
  const audioChain = audioFilterChain(audioEffects);
  if (mode === 'audio') {
    const trims = ranges.map(
      (range, index) => `[0:a]atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a${index}]`,
    );
    const inputs = ranges.map((_range, index) => `[a${index}]`).join('');
    const joined = `${inputs}concat=n=${ranges.length}:v=0:a=1`;
    const filter = audioChain
      ? `${trims.join(';')};${joined}[joined];[joined]${audioChain}[aout]`
      : `${trims.join(';')};${joined}[aout]`;
    return runWithAudioFallback(ffmpeg, [
      '-i', inputName,
      '-filter_complex', filter,
      '-map', '[aout]',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputName,
    ], audioEffects, 'recortar el audio');
  }

  const trims = [];
  const inputs = [];
  ranges.forEach((range, index) => {
    trims.push(`[0:v]trim=start=${range.start}:end=${range.end},setpts=PTS-STARTPTS[v${index}]`);
    trims.push(`[0:a]atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a${index}]`);
    inputs.push(`[v${index}][a${index}]`);
  });
  const joined = `${inputs.join('')}concat=n=${ranges.length}:v=1:a=1`;
  const filter = audioChain
    ? `${trims.join(';')};${joined}[vout][joinedAudio];[joinedAudio]${audioChain}[aout]`
    : `${trims.join(';')};${joined}[vout][aout]`;
  return runWithAudioFallback(ffmpeg, [
    '-i', inputName,
    '-filter_complex', filter,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '21',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputName,
  ], audioEffects, 'recortar el video');
}

async function optimizeMediaCore(blob, mode, onProgress, ffmpeg) {
  const inputExt = extensionFromMime(blob.type);
  const stamp = Date.now();
  const inputName = `input-${stamp}.${inputExt}`;
  const outputName = mode === 'video' ? `output-${stamp}.mp4` : `output-${stamp}.m4a`;

  progressCallback = onProgress || null;
  progressCallback?.(0);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    const args = mode === 'video'
      ? [
          '-i', inputName,
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          outputName,
        ]
      : [
          '-i', inputName,
          '-vn',
          '-c:a', 'aac',
          '-b:a', '128k',
          outputName,
        ];

    const result = await ffmpeg.exec(args);
    if (result !== 0) throw new Error('FFmpeg no pudo completar la optimización.');
    const data = await ffmpeg.readFile(outputName);
    const type = mode === 'video' ? 'video/mp4' : 'audio/mp4';
    progressCallback?.(1);
    return new Blob([data], { type });
  } finally {
    progressCallback = null;
    await safeDelete(ffmpeg, inputName);
    await safeDelete(ffmpeg, outputName);
  }
}

async function cutMediaCore(blob, mode, startSeconds, endSeconds, removedRanges, onProgress, audioEffects, ffmpeg) {
  const start = Math.max(0, Number(startSeconds) || 0);
  const end = Math.max(start + 0.05, Number(endSeconds) || start + 0.05);
  const ranges = keepRanges(start, end, removedRanges);
  if (!ranges.length) throw new Error('Los cortes eliminarían todo el archivo.');

  ffmpeg.setExpectedDuration?.(end - start);
  const inputExt = extensionFromMime(blob.type);
  const stamp = Date.now();
  const inputName = `cut-input-${stamp}.${inputExt}`;
  const outputName = mode === 'video' ? `cut-output-${stamp}.mp4` : `cut-output-${stamp}.m4a`;

  progressCallback = onProgress || null;
  progressCallback?.(0);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    const result = ranges.length === 1
      ? await runSingleRange(ffmpeg, inputName, outputName, mode, ranges[0], audioEffects)
      : await runMultipleRanges(ffmpeg, inputName, outputName, mode, ranges, audioEffects);
    if (result !== 0) throw new Error('FFmpeg no pudo aplicar los cortes.');
    const data = await ffmpeg.readFile(outputName);
    const type = mode === 'video' ? 'video/mp4' : 'audio/mp4';
    progressCallback?.(1);
    return new Blob([data], { type });
  } finally {
    progressCallback = null;
    await safeDelete(ffmpeg, inputName);
    await safeDelete(ffmpeg, outputName);
  }
}

// Apply audio filters while converting the unchanged source to a compatible MP4.
async function enhanceMediaAudioCore(blob, mode, effects, onProgress, ffmpeg) {
  if (!hasAudioEffects(effects)) return blob;
  const stamp = outputNameFor('audio');
  const inputName = `${stamp}-input.${extensionFromMime(blob.type)}`;
  const outputName = mode === 'audio' ? `${stamp}-output.m4a` : `${stamp}-output.mp4`;
  progressCallback = onProgress || null;
  progressCallback?.(0);
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    const args = ['-i', inputName];
    // MediaRecorder normally produces VP8/VP9 WebM. Copying that video to
    // MP4 is unsupported; encode H.264 while retaining the original Blob.
    if (mode === 'video') args.push('-map', '0:v:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p');
    args.push('-map', '0:a:0', '-af', audioFilterChain(effects), '-c:a', 'aac', '-b:a', '160k');
    if (mode === 'video') args.push('-movflags', '+faststart');
    args.push(outputName);
    await runWithAudioFallback(ffmpeg, args, effects, 'mejorar la voz o reducir el ruido');
    const data = await ffmpeg.readFile(outputName);
    progressCallback?.(1);
    return new Blob([data], { type: mode === 'audio' ? 'audio/mp4' : 'video/mp4' });
  } finally {
    progressCallback = null;
    await safeDelete(ffmpeg, inputName);
    await safeDelete(ffmpeg, outputName);
  }
}

// Short A/B samples are made from exactly the same source and time window.
async function createAudioComparisonCore(blob, startSeconds, durationSeconds, effects, ffmpeg) {
  if (!hasAudioEffects(effects)) throw new Error('Activa al menos un efecto para comparar.');
  const stamp = outputNameFor('compare');
  const input = `${stamp}-input.${extensionFromMime(blob.type)}`;
  const original = `audio-original-${stamp}.m4a`;
  const improved = `audio-enhanced-${stamp}.m4a`;
  const start = Math.max(0, Number(startSeconds) || 0);
  const duration = Math.min(12, Math.max(0.3, Number(durationSeconds) || 8));
  ffmpeg.setExpectedDuration?.(duration);
  try {
    await ffmpeg.writeFile(input, await fetchFile(blob));
    const common = ['-ss', String(start), '-i', input, '-t', String(duration), '-vn', '-map', '0:a:0'];
    if (await ffmpeg.exec([...common, '-c:a', 'aac', '-b:a', '128k', original]) !== 0) throw new Error('No se pudo preparar el audio original.');
    await runWithAudioFallback(ffmpeg, [...common, '-af', audioFilterChain(effects), '-c:a', 'aac', '-b:a', '128k', improved], effects, 'preparar la muestra mejorada');
    const [before, after] = await Promise.all([ffmpeg.readFile(original), ffmpeg.readFile(improved)]);
    return { original: new Blob([before], { type: 'audio/mp4' }), improved: new Blob([after], { type: 'audio/mp4' }) };
  } finally {
    await safeDelete(ffmpeg, input);
    await safeDelete(ffmpeg, original);
    await safeDelete(ffmpeg, improved);
  }
}

// The native engine handles Full HD videos on Windows. WebAssembly is always
// an explicit alternative. Failed processing never mutates the source Blob.
const processOptions = (options = {}, onProgress) => ({
  ...options,
  onProgress: (progress) => {
    onProgress?.(progress);
    options.onProgress?.(progress);
  },
  onWasmTerminated: (engine) => {
    if (ffmpegInstance === engine) {
      ffmpegInstance = null;
      progressListenerBound = false;
      loadingPromise = null;
    }
  },
});

export async function optimizeMedia(blob, mode, onProgress, options = {}) {
  const done = await withEngineFallback(
    (engine) => optimizeMediaCore(blob, mode, onProgress, engine),
    getFFmpeg, processOptions(options, onProgress),
  );
  return done.result;
}

export async function cutMedia(blob, mode, startSeconds, endSeconds, removedRanges = [], onProgress, audioEffects = {}, options = {}) {
  const done = await withEngineFallback(
    (engine) => cutMediaCore(blob, mode, startSeconds, endSeconds, removedRanges, onProgress, audioEffects, engine),
    getFFmpeg, processOptions(options, onProgress),
  );
  return done.result;
}

export async function enhanceMediaAudio(blob, mode, effects = {}, onProgress, options = {}) {
  if (!hasAudioEffects(effects)) return blob;
  const done = await withEngineFallback(
    (engine) => enhanceMediaAudioCore(blob, mode, effects, onProgress, engine),
    getFFmpeg, processOptions(options, onProgress),
  );
  return done.result;
}

export async function createAudioComparison(blob, startSeconds, durationSeconds, effects, options = {}) {
  const done = await withEngineFallback(
    (engine) => createAudioComparisonCore(blob, startSeconds, durationSeconds, effects, engine),
    getFFmpeg, processOptions(options),
  );
  return done.result;
}

export async function trimMedia(blob, mode, startSeconds, endSeconds, onProgress, options = {}) {
  return cutMedia(blob, mode, startSeconds, endSeconds, [], onProgress, {}, options);
}

