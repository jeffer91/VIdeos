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

function findNavigationButton(key) {
  const expected = VIEW_LABELS[key];
  if (!expected) return null;
  return [...document.querySelectorAll('.production-nav > button')]
    .find((button) => (button.textContent || '').trim().startsWith(expected)) || null;
}

function navigationBlockedByRecording() {
  return Boolean(document.querySelector(
    '.recording-flow .status-recording, .recording-flow .status-paused, .recording-flow .status-saving, .recording-flow .rec-indicator',
  ));
}

/**
 * Single navigation bridge for enhancer modules.
 * ProductionApp remains the owner of the actual view state; this helper waits
 * until its real navigation control is available and verifies that the target
 * view actually mounted before reporting success.
 */
export async function requestProductionNavigation(key, options = {}) {
  const selector = VIEW_SELECTORS[key];
  if (!selector) return { ok: false, reason: 'unknown-view' };
  if (isProductionViewActive(key)) return { ok: true, alreadyActive: true };

  const timeoutMs = Math.max(800, Number(options.timeoutMs) || 6000);
  const retryMs = Math.max(60, Number(options.retryMs) || 120);
  const startedAt = Date.now();
  let lastReason = 'navigation-unavailable';

  while (Date.now() - startedAt < timeoutMs) {
    if (isProductionViewActive(key)) return { ok: true };

    if (navigationBlockedByRecording()) {
      lastReason = 'recording-busy';
      await delay(retryMs);
      continue;
    }

    const button = findNavigationButton(key);
    if (!button) {
      lastReason = 'nav-not-mounted';
      await delay(retryMs);
      continue;
    }
    if (button.disabled) {
      lastReason = 'nav-disabled';
      await delay(retryMs);
      continue;
    }

    button.click();
    await delay(retryMs);
    if (isProductionViewActive(key)) return { ok: true };
    lastReason = 'view-did-not-change';
  }

  return { ok: false, reason: lastReason };
}

export function viewLabel(key) {
  return VIEW_LABELS[key] || key;
}
