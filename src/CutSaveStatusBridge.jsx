import { useEffect } from 'react';

export default function CutSaveStatusBridge() {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    let lastBusy = false;

    const sync = () => {
      const legacy = document.querySelector('.cut-flow .cut-editor > .primary-button');
      const compact = document.querySelector('.cut-flow .cut-enhancer-footer > .primary-button');
      if (!legacy || !compact) return;

      const busy = Boolean(legacy.disabled) && /Procesando/i.test(legacy.textContent || '');
      compact.disabled = Boolean(legacy.disabled);
      compact.textContent = busy
        ? String(legacy.textContent || 'Procesando…')
        : 'Guardar y siguiente →';
      compact.setAttribute('aria-busy', busy ? 'true' : 'false');

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
