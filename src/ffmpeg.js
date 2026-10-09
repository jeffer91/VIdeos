import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { audioFilterChain, hasAudioEffects } from './audioEffects';

let ffmpegInstance = null;
let loadingPromise = null;
let progressListenerBound = false;
let progressCallback = null;

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

      const base = `${import.meta.env.BASE_URL}ffmpeg/`;
      await ffmpeg.load({
        coreURL: `${base}ffmpeg-core.js`,
        wasmURL: `${base}ffmpeg-core.wasm`,
      });
      return ffmpeg;
    })();
  }

  try {
    return await loadingPromise;
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
  return ffmpeg.exec(args);
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
    return ffmpeg.exec([
      '-i', inputName,
      '-filter_complex', filter,
      '-map', '[aout]',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputName,
    ]);
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
  return ffmpeg.exec([
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
  ]);
}

export async function optimizeMedia(blob, mode, onProgress) {
  const ffmpeg = await getFFmpeg();
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

export async function cutMedia(blob, mode, startSeconds, endSeconds, removedRanges = [], onProgress, audioEffects = {}) {
  const ffmpeg = await getFFmpeg();
  const start = Math.max(0, Number(startSeconds) || 0);
  const end = Math.max(start + 0.05, Number(endSeconds) || start + 0.05);
  const ranges = keepRanges(start, end, removedRanges);
  if (!ranges.length) throw new Error('Los cortes eliminarían todo el archivo.');

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
export async function enhanceMediaAudio(blob, mode, effects = {}, onProgress) {
  if (!hasAudioEffects(effects)) return blob;
  const ffmpeg = await getFFmpeg();
  const stamp = Date.now();
  const inputName = `audio-input-${stamp}.${extensionFromMime(blob.type)}`;
  const outputName = mode === 'audio' ? `audio-output-${stamp}.m4a` : `audio-output-${stamp}.mp4`;
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
    const result = await ffmpeg.exec(args);
    if (result !== 0) throw new Error('FFmpeg no pudo aplicar los efectos de audio.');
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
export async function createAudioComparison(blob, startSeconds, durationSeconds, effects) {
  if (!hasAudioEffects(effects)) throw new Error('Activa al menos un efecto para comparar.');
  const ffmpeg = await getFFmpeg();
  const stamp = Date.now();
  const input = `audio-compare-${stamp}.${extensionFromMime(blob.type)}`;
  const original = `audio-original-${stamp}.m4a`;
  const improved = `audio-enhanced-${stamp}.m4a`;
  const start = Math.max(0, Number(startSeconds) || 0);
  const duration = Math.min(12, Math.max(0.3, Number(durationSeconds) || 8));
  try {
    await ffmpeg.writeFile(input, await fetchFile(blob));
    const common = ['-ss', String(start), '-i', input, '-t', String(duration), '-vn', '-map', '0:a:0'];
    if (await ffmpeg.exec([...common, '-c:a', 'aac', '-b:a', '128k', original]) !== 0) throw new Error('No se pudo preparar el audio original.');
    if (await ffmpeg.exec([...common, '-af', audioFilterChain(effects), '-c:a', 'aac', '-b:a', '128k', improved]) !== 0) throw new Error('No se pudo preparar el audio mejorado.');
    const [before, after] = await Promise.all([ffmpeg.readFile(original), ffmpeg.readFile(improved)]);
    return { original: new Blob([before], { type: 'audio/mp4' }), improved: new Blob([after], { type: 'audio/mp4' }) };
  } finally {
    await safeDelete(ffmpeg, input);
    await safeDelete(ffmpeg, original);
    await safeDelete(ffmpeg, improved);
  }
}

export async function trimMedia(blob, mode, startSeconds, endSeconds, onProgress) {
  return cutMedia(blob, mode, startSeconds, endSeconds, [], onProgress);
}
