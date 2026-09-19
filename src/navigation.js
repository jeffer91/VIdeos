const VIEW_SELECTORS = {
  content: '.content-flow',
  recording: '.recording-flow',
  cut: '.cut-flow',
  library: '.library-flow',
  join: '.join-flow',
  memes: '.memes-flow',
  result: '.result-flow',
};

const VIEW_LABELS = {
  content: 'Contenido',
  recording: 'Grabación',
  cut: 'Corte',
  library: 'Biblioteca',
  join: 'Unión',
  memes: 'Video memes',
  result: 'Resultado',
};

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function isProductionViewActive(key) {
  const selector = VIEW_SELECTORS[key];
  return Boolean(selector && document.querySelector(selector));
}

/**
 * Shared navigation bridge for enhancer modules.
 * ProductionApp owns the view state. Enhancers request a view change through
 * a custom event instead of locating a navigation button and simulating a click.
 */
export async function requestProductionNavigation(key, options = {}) {
  const selector = VIEW_SELECTORS[key];
  if (!selector) return { ok: false, reason: 'unknown-view' };
  if (isProductionViewActive(key)) return { ok: true, alreadyActive: true };

  const timeoutMs = Math.max(500, Number(options.timeoutMs) || 3000);
  const retryMs = Math.max(40, Number(options.retryMs) || 80);
  const startedAt = Date.now();

  window.dispatchEvent(new CustomEvent('videosstudio:navigate', {
    detail: { view: key },
  }));

  while (Date.now() - startedAt < timeoutMs) {
    if (isProductionViewActive(key)) return { ok: true };
    await delay(retryMs);
  }

  return { ok: false, reason: 'view-did-not-change' };
}

export function viewLabel(key) {
  return VIEW_LABELS[key] || key;
}
