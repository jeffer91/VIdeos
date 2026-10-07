export function readPrompterPreference(name, fallback, min, max) {
  try {
    const saved = localStorage.getItem(`videosstudio:prompter:${name}`);
    const value = saved === null ? NaN : Number(saved);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  } catch {
    return fallback;
  }
}

export function waitForCountdown(signal, milliseconds = 1000) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const done = (value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      resolve(value);
    };
    const cancel = () => done(false);
    const timer = setTimeout(() => done(true), milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
