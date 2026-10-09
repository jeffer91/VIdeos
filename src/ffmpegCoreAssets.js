import { toBlobURL } from '@ffmpeg/util';

const CORE_FILES = Object.freeze([
  ['ffmpeg-core.js', 'text/javascript'],
  ['ffmpeg-core.wasm', 'application/wasm'],
]);

async function resolveAsset(name, type) {
  const url = new URL(`${import.meta.env.BASE_URL}ffmpeg/${name}`, document.baseURI).href;
  try {
    return await toBlobURL(url, type);
  } catch (caught) {
    // Packaged Electron can deny fetch(file://...). IPC is limited to core files.
    const readBundled = window.videosStudio?.ffmpeg?.readCoreAsset;
    if (typeof readBundled !== 'function') {
      throw new Error(`No se pudo cargar ${name}: ${caught?.message || 'recurso no disponible'}.`);
    }
    const bytes = await readBundled(name);
    if (!bytes?.byteLength) throw new Error(`Falta ${name} en la instalación.`);
    return URL.createObjectURL(new Blob([bytes], { type }));
  }
}

export async function loadFFmpegCore(ffmpeg) {
  const urls = [];
  try {
    // Load serially so a failed second download does not leak the first Blob URL.
    for (const [filename, contentType] of CORE_FILES) {
      urls.push(await resolveAsset(filename, contentType));
    }
    await ffmpeg.load({ coreURL: urls[0], wasmURL: urls[1] });
    if (!ffmpeg.loaded) throw new Error('El motor FFmpeg no confirmó su inicialización.');
    return ffmpeg;
  } catch (error) {
    throw new Error(`No se pudo iniciar FFmpeg para renderizar el video: ${error?.message || error}`);
  } finally {
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}
