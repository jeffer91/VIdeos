import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpegInstance = null;
let loadPromise = null;
let activeProgress = null;
let progressBound = false;

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

async function getFFmpeg() {
  if (!ffmpegInstance) ffmpegInstance = new FFmpeg();
  if (ffmpegInstance.loaded) return ffmpegInstance;
  if (!loadPromise) {
    loadPromise = (async () => {
      if (!progressBound) {
        ffmpegInstance.on('progress', ({ progress }) => {
          activeProgress?.(Math.max(0, Math.min(1, Number(progress) || 0)));
        });
        progressBound = true;
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
  if (!name) return;
  try { await ffmpeg.deleteFile(name); } catch { /* best effort */ }
}

function extension(blob, fallback = 'bin') {
  const type = String(blob?.type || '').toLowerCase();
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('webm')) return 'webm';
  if (type.includes('quicktime')) return 'mov';
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  return fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function zonePixels(zone, fallback) {
  const value = zone || fallback;
  return {
    x: Math.round(clamp(value.x, 0, 1) * WIDTH),
    y: Math.round(clamp(value.y, 0, 1) * HEIGHT),
    w: Math.max(2, Math.round(clamp(value.w, 0.02, 1) * WIDTH)),
    h: Math.max(2, Math.round(clamp(value.h, 0.02, 1) * HEIGHT)),
  };
}

const DEFAULT_ZONES = {
  visual: { x: .05, y: .10, w: .52, h: .78 },
  data: { x: .60, y: .10, w: .35, h: .36 },
  video: { x: .60, y: .52, w: .35, h: .36 },
};

function themeColors(theme = 'blue') {
  if (theme === 'green') return { bg: '#071c17', panel: '#102c25', accent: '#32c694', text: '#f7fffc', muted: '#c7e4da' };
  if (theme === 'gold') return { bg: '#18140a', panel: '#2d2717', accent: '#d6a839', text: '#fffdf5', muted: '#e6dbc0' };
  return { bg: '#091426', panel: '#13233d', accent: '#4d7dff', text: '#f7faff', muted: '#cad7ef' };
}

function wrapLines(context, text, maxWidth) {
  const paragraphs = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lines = [];
  for (const paragraph of paragraphs) {
    const bullet = /^[-•*]\s*/.test(paragraph) ? '• ' : '';
    const clean = paragraph.replace(/^[-•*]\s*/, '');
    const words = clean.split(/\s+/);
    let current = bullet;
    for (const word of words) {
      const candidate = current === bullet ? `${bullet}${word}` : `${current} ${word}`;
      if (context.measureText(candidate).width <= maxWidth || current === bullet) current = candidate;
      else {
        lines.push(current);
        current = `${bullet ? '  ' : ''}${word}`;
      }
    }
    if (current.trim()) lines.push(current);
  }
  return lines;
}

async function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo crear el lienzo de la escena.')), 'image/png');
  });
}

async function createSceneBackground(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el compositor de escena.');

  if (scene.templateBlob?.size) {
    const bitmap = await createImageBitmap(scene.templateBlob);
    try { ctx.drawImage(bitmap, 0, 0, WIDTH, HEIGHT); } finally { bitmap.close?.(); }
  } else {
    const colors = themeColors(scene.theme);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const visual = zonePixels(null, DEFAULT_ZONES.visual);
    const data = zonePixels(null, DEFAULT_ZONES.data);
    const video = zonePixels(null, DEFAULT_ZONES.video);
    ctx.fillStyle = colors.panel;
    [visual, data, video].forEach((zone) => ctx.fillRect(zone.x, zone.y, zone.w, zone.h));
    ctx.fillStyle = colors.accent;
    ctx.fillRect(data.x, data.y, 8, data.h);
  }

  const zones = scene.templateMetadata?.zones || DEFAULT_ZONES;
  const data = zonePixels(zones.data, DEFAULT_ZONES.data);
  const colors = themeColors(scene.theme);
  const padding = Math.max(28, Math.round(data.w * .06));
  const x = data.x + padding;
  const maxWidth = Math.max(80, data.w - padding * 2);
  let y = data.y + padding + 38;

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = scene.templateBlob ? '#ffffff' : colors.text;
  ctx.shadowColor = 'rgba(0,0,0,.42)';
  ctx.shadowBlur = scene.templateBlob ? 5 : 0;
  ctx.font = '700 44px Arial, sans-serif';
  const titleLines = wrapLines(ctx, scene.slide?.title || '', maxWidth).slice(0, 3);
  for (const line of titleLines) {
    ctx.fillText(line, x, y);
    y += 51;
  }

  y += 10;
  ctx.font = '500 26px Arial, sans-serif';
  ctx.fillStyle = scene.templateBlob ? '#f6f8fb' : colors.muted;
  const points = `${scene.slide?.body || ''}\n${scene.slide?.content || ''}`;
  const pointLines = wrapLines(ctx, points, maxWidth);
  const lineHeight = 34;
  const maxLines = Math.max(2, Math.floor((data.y + data.h - padding - y) / lineHeight));
  pointLines.slice(0, maxLines).forEach((line) => {
    ctx.fillText(line, x, y);
    y += lineHeight;
  });
  ctx.shadowBlur = 0;
  return canvasBlob(canvas);
}

async function inspectMedia(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    const finish = async () => {
      let hasAudio = false;
      try {
        await video.play();
        const stream = video.captureStream?.();
        hasAudio = Boolean(stream?.getAudioTracks?.().length);
        video.pause();
        stream?.getTracks?.().forEach((track) => track.stop());
      } catch {
        hasAudio = Boolean(video.mozHasAudio || Number(video.webkitAudioDecodedByteCount) > 0);
      }
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      URL.revokeObjectURL(url);
      resolve({ duration, hasAudio });
    };
    video.onloadedmetadata = finish;
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ duration: 0, hasAudio: false });
    };
    video.src = url;
  });
}

function fitFilter(label, zone, mode = 'contain', outLabel) {
  if (mode === 'cover') {
    return `[${label}]scale=${zone.w}:${zone.h}:force_original_aspect_ratio=increase,crop=${zone.w}:${zone.h},setsar=1[${outLabel}]`;
  }
  return `[${label}]scale=${zone.w}:${zone.h}:force_original_aspect_ratio=decrease,pad=${zone.w}:${zone.h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${outLabel}]`;
}

async function renderScene(ffmpeg, scene, stamp, reportProgress) {
  const number = Number(scene.slide?.number) || 0;
  const inputName = `scene-${stamp}-${number}-presenter.${extension(scene.videoBlob, 'webm')}`;
  const backgroundName = `scene-${stamp}-${number}-background.png`;
  const outputName = `scene-${stamp}-${number}.mp4`;
  const temp = [inputName, backgroundName, outputName];
  const background = await createSceneBackground(scene);
  await ffmpeg.writeFile(inputName, await fetchFile(scene.videoBlob));
  await ffmpeg.writeFile(backgroundName, await fetchFile(background));

  const args = ['-i', inputName, '-loop', '1', '-i', backgroundName];
  const filters = [`[1:v]scale=${WIDTH}:${HEIGHT},setsar=1[base]`];
  const zones = scene.templateMetadata?.zones || DEFAULT_ZONES;
  const presenterZone = zonePixels(zones.video, DEFAULT_ZONES.video);
  const visualZone = zonePixels(zones.visual, DEFAULT_ZONES.visual);
  filters.push(fitFilter('0:v', presenterZone, 'contain', 'presenter'));
  filters.push(`[base][presenter]overlay=${presenterZone.x}:${presenterZone.y}[stage0]`);

  const visuals = scene.visuals || [];
  const duration = Math.max(.05, Number(scene.durationSeconds) || 0.05);
  const perImage = visuals.length ? duration / visuals.length : duration;
  let stage = 'stage0';
  for (let index = 0; index < visuals.length; index += 1) {
    const visual = visuals[index];
    const name = `scene-${stamp}-${number}-visual-${index}.${extension(visual.blob, 'jpg')}`;
    temp.push(name);
    await ffmpeg.writeFile(name, await fetchFile(visual.blob));
    args.push('-loop', '1', '-i', name);
    const inputIndex = index + 2;
    const fit = scene.visualSettings?.fit === 'contain' ? 'contain' : 'cover';
    const label = `vis${index}`;
    filters.push(fitFilter(`${inputIndex}:v`, visualZone, fit, label));
    const start = index * perImage;
    const end = index === visuals.length - 1 ? duration : (index + 1) * perImage;
    const nextStage = `stage${index + 1}`;
    filters.push(`[${stage}][${label}]overlay=${visualZone.x}:${visualZone.y}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${nextStage}]`);
    stage = nextStage;
  }
  filters.push(`[${stage}]fps=${FPS},format=yuv420p[vout]`);

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', '0:a:0?',
    '-t', String(duration),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '21',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-ar', '48000',
    '-ac', '2',
    '-b:a', '160k',
    '-movflags', '+faststart',
    outputName,
  );

  activeProgress = reportProgress || null;
  try {
    const result = await ffmpeg.exec(args);
    if (result !== 0) throw new Error(`No se pudo componer la diapositiva ${number}.`);
    return { name: outputName, temp };
  } catch (caught) {
    for (const name of temp) await safeDelete(ffmpeg, name);
    throw caught;
  } finally {
    activeProgress = null;
  }
}

async function normalizeResource(ffmpeg, blob, stamp, label, reportProgress) {
  const info = await inspectMedia(blob);
  if (!info.duration) throw new Error(`No se pudo leer la duración del recurso ${label}.`);
  const input = `resource-${stamp}-${label}.${extension(blob, 'mp4')}`;
  const output = `resource-${stamp}-${label}.mp4`;
  await ffmpeg.writeFile(input, await fetchFile(blob));
  const baseArgs = ['-i', input];
  const mapArgs = ['-map', '0:v:0'];
  if (info.hasAudio) mapArgs.push('-map', '0:a:0');
  else {
    baseArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    mapArgs.push('-map', '1:a:0');
  }
  const args = [
    ...baseArgs,
    '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}`,
    ...mapArgs,
    '-t', String(info.duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k',
    '-movflags', '+faststart', output,
  ];
  activeProgress = reportProgress || null;
  try {
    const result = await ffmpeg.exec(args);
    if (result !== 0) throw new Error(`No se pudo preparar el recurso ${label}.`);
    return { name: output, temp: [input, output], duration: info.duration };
  } catch (caught) {
    await safeDelete(ffmpeg, input);
    await safeDelete(ffmpeg, output);
    throw caught;
  } finally {
    activeProgress = null;
  }
}

async function cutNormalized(ffmpeg, source, stamp, label, start, end) {
  const output = `piece-${stamp}-${label}.mp4`;
  const duration = Math.max(.03, end - start);
  const result = await ffmpeg.exec([
    '-ss', String(start), '-i', source, '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k',
    '-movflags', '+faststart', output,
  ]);
  if (result !== 0) throw new Error('No se pudo dividir una escena para insertar el video meme.');
  return output;
}

async function memeSegment(ffmpeg, sceneName, event, memeBlob, stamp, label) {
  const info = await inspectMedia(memeBlob);
  if (!info.duration) throw new Error('No se pudo leer la duración de un video meme.');
  const freeze = `meme-freeze-${stamp}-${label}.png`;
  const memeInput = `meme-input-${stamp}-${label}.${extension(memeBlob, 'mp4')}`;
  const output = `meme-segment-${stamp}-${label}.mp4`;
  await ffmpeg.writeFile(memeInput, await fetchFile(memeBlob));
  const frameResult = await ffmpeg.exec(['-ss', String(event.atSeconds), '-i', sceneName, '-frames:v', '1', freeze]);
  if (frameResult !== 0) throw new Error('No se pudo congelar el fotograma para el video meme.');

  const scale = event.size === 'small' ? .38 : event.size === 'large' ? .78 : .56;
  const targetW = Math.round(WIDTH * scale);
  const targetH = Math.round(HEIGHT * scale);
  const blur = clamp(event.blur, 0, 20);
  const baseFilter = blur > 0
    ? `[0:v]scale=${WIDTH}:${HEIGHT},boxblur=luma_radius=${Math.max(1, Math.round(blur))}:luma_power=1[bg]`
    : `[0:v]scale=${WIDTH}:${HEIGHT}[bg]`;
  const filters = [
    baseFilter,
    `[1:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[meme]`,
    `[bg][meme]overlay=(W-w)/2:(H-h)/2,fps=${FPS},format=yuv420p[vout]`,
  ];
  const args = ['-loop', '1', '-i', freeze, '-i', memeInput];
  if (!info.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  args.push('-map', info.hasAudio ? '1:a:0' : '2:a:0');
  args.push(
    '-t', String(info.duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k',
    '-movflags', '+faststart', output,
  );
  const result = await ffmpeg.exec(args);
  if (result !== 0) throw new Error('No se pudo componer el video meme.');
  await safeDelete(ffmpeg, freeze);
  await safeDelete(ffmpeg, memeInput);
  return { name: output, duration: info.duration };
}

async function expandSceneWithMemes(ffmpeg, sceneName, duration, events, memeBlobs, stamp, slideNumber) {
  const valid = [...(events || [])]
    .filter((event) => event.atSeconds >= 0 && event.atSeconds < duration && memeBlobs.get(event.assetPath))
    .sort((a, b) => a.atSeconds - b.atSeconds);
  if (!valid.length) return { names: [sceneName], generated: [] };

  const names = [];
  const generated = [];
  let cursor = 0;
  for (let index = 0; index < valid.length; index += 1) {
    const event = valid[index];
    if (event.atSeconds - cursor >= .03) {
      const pre = await cutNormalized(ffmpeg, sceneName, stamp, `${slideNumber}-${index}-pre`, cursor, event.atSeconds);
      names.push(pre);
      generated.push(pre);
    }
    const meme = await memeSegment(ffmpeg, sceneName, event, memeBlobs.get(event.assetPath), stamp, `${slideNumber}-${index}`);
    names.push(meme.name);
    generated.push(meme.name);
    cursor = event.atSeconds;
  }
  if (duration - cursor >= .03) {
    const post = await cutNormalized(ffmpeg, sceneName, stamp, `${slideNumber}-post`, cursor, duration);
    names.push(post);
    generated.push(post);
  }
  return { names, generated };
}

async function concatNames(ffmpeg, names, stamp) {
  if (!names.length) throw new Error('No hay clips para construir el video final.');
  if (names.length === 1) {
    const data = await ffmpeg.readFile(names[0]);
    return new Blob([data], { type: 'video/mp4' });
  }
  const list = `production-list-${stamp}.txt`;
  const output = `production-output-${stamp}.mp4`;
  await ffmpeg.writeFile(list, new TextEncoder().encode(names.map((name) => `file '${name}'`).join('\n')));
  const result = await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', output]);
  if (result !== 0) throw new Error('No se pudieron unir todos los clips de producción.');
  const data = await ffmpeg.readFile(output);
  await safeDelete(ffmpeg, list);
  await safeDelete(ffmpeg, output);
  return new Blob([data], { type: 'video/mp4' });
}

export async function renderProductionVideo(plan, onProgress) {
  const ffmpeg = await getFFmpeg();
  const stamp = Date.now();
  const sequence = [];
  const cleanup = [];
  const scenes = plan.scenes || [];
  const totalSteps = Math.max(1, scenes.length + (plan.introBlob ? 1 : 0) + (plan.endingBlob ? 1 : 0));
  let completed = 0;
  const report = (phase, detail = '', inner = 0) => {
    onProgress?.({
      phase,
      detail,
      current: completed,
      total: totalSteps,
      progress: Math.min(.98, (completed + inner) / totalSteps),
    });
  };

  const resourceCache = new Map();
  const prepareResource = async (path, blob, label) => {
    if (!path || !blob) return null;
    if (resourceCache.has(path)) return resourceCache.get(path);
    report('resources', label, 0);
    const prepared = await normalizeResource(ffmpeg, blob, stamp, `${label}-${resourceCache.size}`, (value) => report('resources', label, value));
    cleanup.push(...prepared.temp);
    resourceCache.set(path, prepared.name);
    return prepared.name;
  };

  try {
    if (plan.introBlob) {
      const intro = await normalizeResource(ffmpeg, plan.introBlob, stamp, 'intro', (value) => report('intro', 'Intro', value));
      sequence.push(intro.name);
      cleanup.push(...intro.temp);
      completed += 1;
      report('intro', 'Intro listo');
    }

    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      report('scene', `Diapositiva ${scene.slide.number}`, 0);
      const rendered = await renderScene(ffmpeg, scene, stamp, (value) => report('scene', `Diapositiva ${scene.slide.number}`, value));
      cleanup.push(...rendered.temp);

      const expanded = await expandSceneWithMemes(
        ffmpeg,
        rendered.name,
        scene.durationSeconds,
        scene.memes,
        plan.memeBlobs || new Map(),
        stamp,
        scene.slide.number,
      );
      sequence.push(...expanded.names);
      cleanup.push(...expanded.generated);

      if (scene.ctaPath && plan.resourceBlobs?.get(scene.ctaPath)) {
        const cta = await prepareResource(scene.ctaPath, plan.resourceBlobs.get(scene.ctaPath), `cta-${scene.slide.number}`);
        if (cta) sequence.push(cta);
      }
      if (index < scenes.length - 1 && scene.transitionPath && plan.resourceBlobs?.get(scene.transitionPath)) {
        const transition = await prepareResource(scene.transitionPath, plan.resourceBlobs.get(scene.transitionPath), `transition-${scene.slide.number}`);
        if (transition) sequence.push(transition);
      }
      completed += 1;
      report('scene', `Diapositiva ${scene.slide.number} lista`);
    }

    if (plan.endingBlob) {
      const ending = await normalizeResource(ffmpeg, plan.endingBlob, stamp, 'ending', (value) => report('ending', 'Ending', value));
      sequence.push(ending.name);
      cleanup.push(...ending.temp);
      completed += 1;
      report('ending', 'Ending listo');
    }

    report('joining', 'Uniendo producción', 0);
    const result = await concatNames(ffmpeg, sequence, stamp);
    onProgress?.({ phase: 'done', detail: 'MP4 final listo', current: totalSteps, total: totalSteps, progress: 1 });
    return result;
  } finally {
    activeProgress = null;
    for (const name of new Set(cleanup)) await safeDelete(ffmpeg, name);
  }
}
