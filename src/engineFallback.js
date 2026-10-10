import { NativeFFmpeg, nativeAvailable } from './nativeFFmpeg';
import { readProcessingPreferences, engineLabel } from './processingPreferences';

export function isUserCancelled(error, signal) {
  return signal?.aborted || /procesamiento cancelado|cancelled by user/i.test(String(error?.message || error));
}
// One motor at a time. Never create a second encoder until the first has stopped.
export async function withEngineFallback(action, createWasm, options = {}) {
  const pref = { ...readProcessingPreferences(), ...options };
  const native = await nativeAvailable();
  const preferred = pref.method === 'wasm' ? 'wasm' : pref.method === 'native' ? 'native' : (native ? 'native' : 'wasm');
  const order = pref.fallback ? [preferred, preferred === 'native' ? 'wasm' : 'native'] : [preferred];
  const diagnostics = [];
  let lastError = null;
  for (const method of order) {
    if (options.signal?.aborted) throw new Error('Procesamiento cancelado por el usuario.');
    if (method === 'native' && !native) {
      lastError = new Error('FFmpeg nativo no está disponible en esta instalación.');
      diagnostics.push(lastError.message);
      continue;
    }
    let engine;
    let cancel;
    let progressListener;
    try {
      options.onStatus?.({ phase: 'loading', method, progress: null, diagnostics: [...diagnostics] });
      engine = method === 'native' ? await new NativeFFmpeg().load() : await createWasm();
      if (options.signal?.aborted) throw new Error('Procesamiento cancelado por el usuario.');
      cancel = () => {
        if (method === 'native') void engine.cancel();
        else {
          try { engine.terminate?.(); } catch { /* Already stopped */ }
          options.onWasmTerminated?.(engine);
        }
      };
      options.signal?.addEventListener('abort', cancel, { once: true });
      progressListener = ({ progress }) => {
        if (!options.signal?.aborted && Number.isFinite(progress)) {
          options.onProgress?.(Math.max(0, Math.min(.99, Number(progress))));
        }
      };
      engine.on('progress', progressListener);
      options.onStatus?.({ phase: 'processing', method, progress: 0, diagnostics: [...diagnostics] });
      const result = await action(engine, method);
      if (options.signal?.aborted) throw new Error('Procesamiento cancelado por el usuario.');
      options.onProgress?.(1);
      options.onStatus?.({ phase: 'done', method, progress: 1, diagnostics: [...diagnostics] });
      return { result, method, diagnostics };
    } catch (caught) {
      if (isUserCancelled(caught, options.signal)) throw new Error('Procesamiento cancelado por el usuario.');
      lastError = caught;
      diagnostics.push(engineLabel(method) + ': ' + String(caught?.message || caught));
      options.onStatus?.({ phase: 'failed', method, progress: null, diagnostics: [...diagnostics] });
    } finally {
      if (cancel && options.signal) options.signal.removeEventListener('abort', cancel);
      if (progressListener) engine?.off?.('progress', progressListener);
      if (method === 'native') await engine?.close?.();
    }
  }
  throw new Error('Fallaron los motores de procesamiento. ' + diagnostics.join(' | ') + (lastError ? '' : ' Sin detalles.'));
}
