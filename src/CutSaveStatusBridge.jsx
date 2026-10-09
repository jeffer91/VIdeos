import { useEffect } from 'react';

// The legacy save button owns the actual cut operation. The compact button
// mirrors its state without creating a recursive MutationObserver update.
export default function CutSaveStatusBridge() {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    let lastBusy = false;

    const sync = () => {
      const legacy = document.querySelector('.cut-flow .cut-editor > .primary-button');
      const compact = document.querySelector('.cut-flow .cut-enhancer-footer > .primary-button');
      if (!legacy || !compact) {
        lastBusy = false;
        return;
      }

      const busy = Boolean(legacy.disabled) && /Procesando/i.test(legacy.textContent || '');
      const label = busy ? String(legacy.textContent || 'Procesando…') : 'Guardar y siguiente →';
      const ariaBusy = String(busy);

      // Writing textContent or attributes unconditionally retriggers the
      // subtree observer and can freeze the entire Electron renderer.
      if (compact.disabled !== legacy.disabled) compact.disabled = legacy.disabled;
      if (compact.textContent !== label) compact.textContent = label;
      if (compact.getAttribute('aria-busy') !== ariaBusy) {
        compact.setAttribute('aria-busy', ariaBusy);
      }

      if (lastBusy && !busy) {
        window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
      }
      lastBusy = busy;
    };

    const observer = new MutationObserver(sync);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['disabled', 'class'],
    });
    sync();
    return () => observer.disconnect();
  }, []);

  return null;
}
