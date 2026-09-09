import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

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
    const args =
      mode === 'video'
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

export async function trimMedia(blob, mode, startSeconds, endSeconds, onProgress) {
  const ffmpeg = await getFFmpeg();
  const start = Math.max(0, Number(startSeconds) || 0);
  const end = Math.max(start + 0.05, Number(endSeconds) || start + 0.05);
  const duration = end - start;
  const inputExt = extensionFromMime(blob.type);
  const stamp = Date.now();
  const inputName = `trim-input-${stamp}.${inputExt}`;
  const outputName = mode === 'video' ? `trim-output-${stamp}.mp4` : `trim-output-${stamp}.m4a`;

  progressCallback = onProgress || null;
  progressCallback?.(0);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    const args = mode === 'video'
      ? [
          '-ss', String(start),
          '-i', inputName,
          '-t', String(duration),
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '21',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          outputName,
        ]
      : [
          '-ss', String(start),
          '-i', inputName,
          '-t', String(duration),
          '-vn',
          '-c:a', 'aac',
          '-b:a', '128k',
          outputName,
        ];

    const result = await ffmpeg.exec(args);
    if (result !== 0) throw new Error('FFmpeg no pudo aplicar el corte.');
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
