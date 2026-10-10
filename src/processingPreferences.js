const KEY = 'videos-studio-processing-engine-v1';
export const DEFAULT_PROCESSING = Object.freeze({ method: 'auto', fallback: true });
export function normalizeProcessing(value) {
  return {
    method: ['auto','native','wasm'].includes(value?.method) ? value.method : 'auto',
    fallback: value?.fallback !== false,
  };
}
export function readProcessingPreferences() {
  try { return normalizeProcessing(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return { ...DEFAULT_PROCESSING }; }
}
export function saveProcessingPreferences(value) {
  const next = normalizeProcessing(value);
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('videosstudio:processing-preferences', { detail: next }));
  return next;
}
export function engineLabel(method) { return method === 'native' ? 'Nativo Windows' : 'WebAssembly'; }
