import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpegInstance = null;
let loadPromise = null;
let progressListenerBound = false;
let activeProgress = null;

async function getFFmpeg() {
  if (!ffmpegInstance) ffmpegInstance = new FFmpeg();
  if (ffmpegInstance.loaded) return ffmpegInstance;

  if (!loadPromise) {
    loadPromise = (async () => {
      if (!progressListenerBound) {
        ffmpegInstance.on('progress', ({ progress }) => {
          activeProgress?.(Math.max(0, Math.min(1, Number(progress) || 0)));
        });
        progressListenerBound = true;
      }
      const base = `${import.meta.env.BASE_URL}ffmpeg/`;
      await ffmpegInstance.load({
        coreURL: `${base}ffmpeg-core.js`,
        wasmURL: `${base}ffmpeg-core.wasm`,
      });
      return ffmpegInstance;
    })();
  }

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function safeDelete(ffmpeg, name) {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // Limpieza best-effort del sistema de archivos virtual de FFmpeg.
  }
}

function extensionFromBlob(blob) {
  const type = String(blob?.type || '').toLowerCase();
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('quicktime')) return 'mov';
  return 'webm';
}

function sanitizeTitle(value = 'video') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'video';
}

export function finalVideoFilename(project) {
  return `11-records-${sanitizeTitle(project?.name || 'video')}.mp4`;
}

export async function renderCleanSceneSequence(sceneBlobs = [], onProgress) {
  if (!sceneBlobs.length) throw new Error('No hay escenas limpias para renderizar.');
  if (sceneBlobs.some((blob) => !(blob instanceof Blob) || !blob.size)) {
    throw new Error('Una o más escenas no contienen video válido.');
  }

  const ffmpeg = await getFFmpeg();
  const stamp = Date.now();
  const segmentNames = [];
  const tempNames = [];
  const total = sceneBlobs.length;

  const report = (payload) => onProgress?.({
    phase: payload.phase,
    current: payload.current,
    total,
    progress: Math.max(0, Math.min(1, payload.progress)),
  });

  try {
    for (let index = 0; index < sceneBlobs.length; index += 1) {
      const blob = sceneBlobs[index];
      const inputName = `final-input-${stamp}-${index}.${extensionFromBlob(blob)}`;
      const segmentName = `final-segment-${stamp}-${String(index).padStart(3, '0')}.mp4`;
      tempNames.push(inputName, segmentName);
      segmentNames.push(segmentName);

      report({ phase: 'normalizing', current: index + 1, progress: index / total * 0.9 });
      await ffmpeg.writeFile(inputName, await fetchFile(blob));
      activeProgress = (value) => {
        report({
          phase: 'normalizing',
          current: index + 1,
          progress: ((index + value) / total) * 0.9,
        });
      };

      const result = await ffmpeg.exec([
        '-i', inputName,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '21',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-ar', '48000',
        '-ac', '2',
        '-b:a', '160k',
        '-movflags', '+faststart',
        segmentName,
      ]);
      if (result !== 0) throw new Error(`FFmpeg no pudo preparar la escena ${index + 1}.`);
      await safeDelete(ffmpeg, inputName);
    }

    const concatName = `final-list-${stamp}.txt`;
    const outputName = `final-output-${stamp}.mp4`;
    tempNames.push(concatName, outputName);
    const concatText = segmentNames.map((name) => `file '${name}'`).join('\n');
    await ffmpeg.writeFile(concatName, new TextEncoder().encode(concatText));

    activeProgress = (value) => report({
      phase: 'joining',
      current: total,
      progress: 0.9 + (value * 0.1),
    });
    report({ phase: 'joining', current: total, progress: 0.9 });

    const concatResult = await ffmpeg.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', concatName,
      '-c', 'copy',
      '-movflags', '+faststart',
      outputName,
    ]);
    if (concatResult !== 0) throw new Error('FFmpeg no pudo unir las escenas finales.');

    const data = await ffmpeg.readFile(outputName);
    report({ phase: 'done', current: total, progress: 1 });
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    activeProgress = null;
    for (const name of tempNames) await safeDelete(ffmpeg, name);
  }
}
