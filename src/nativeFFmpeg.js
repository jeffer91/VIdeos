// FFmpeg-like adapter for the isolated Electron native process.
export class NativeFFmpeg {
  constructor() {
    this.id = null;
    this.loaded = false;
    this.listeners = { progress: new Set(), log: new Set() };
    this.expectedDuration = 0;
    this.unsubscribe = null;
  }
  on(event, handler) {
    if (this.listeners[event] && typeof handler === 'function') this.listeners[event].add(handler);
    return this;
  }
  async load() {
    const api = window.videosStudio?.nativeFFmpeg;
    if (!api) throw new Error('El motor nativo requiere Videos Studio para Windows.');
    this.id = await api.open();
    this.unsubscribe = api.onProgress?.(({ id, ...detail }) => {
      if (id !== this.id) return;
      if (typeof detail.progress === 'number') this.listeners.progress.forEach((cb) => cb({ progress: detail.progress }));
      this.listeners.log.forEach((cb) => cb({ message: detail.phase || 'Procesando' }));
    });
    this.loaded = true;
    return this;
  }
  setExpectedDuration(seconds) {
    this.expectedDuration = Math.max(0, Number(seconds) || 0);
  }
  async writeFile(name, input) {
    if (!this.loaded) throw new Error('FFmpeg nativo no está listo.');
    const raw = input instanceof Uint8Array ? input : new Uint8Array(input);
    return window.videosStudio.nativeFFmpeg.write(this.id, name, raw);
  }
  async readFile(name) {
    return new Uint8Array(await window.videosStudio.nativeFFmpeg.read(this.id, name));
  }
  async deleteFile(name) {
    return window.videosStudio.nativeFFmpeg.delete(this.id, name);
  }
  async exec(args) {
    try {
      return await window.videosStudio.nativeFFmpeg.exec(this.id, args, this.expectedDuration);
    } catch (error) {
      this.listeners.log.forEach((cb) => cb({ message: String(error?.message || error) }));
      throw error;
    }
  }
  async cancel() {
    if (this.id) await window.videosStudio.nativeFFmpeg.cancel(this.id);
  }
  async close() {
    const id = this.id;
    this.id = null;
    this.loaded = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (id) await window.videosStudio.nativeFFmpeg.close(id).catch(() => {});
  }
}

export async function nativeAvailable() {
  try { return Boolean((await window.videosStudio?.nativeFFmpeg?.status?.())?.available); }
  catch { return false; }
}
