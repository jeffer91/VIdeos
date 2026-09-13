import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { clearRecordingData, getChunks, getRecordingMeta } from './storage';

export default function RecoverySafetyGuard() {
  const [banner, setBanner] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refreshRecovery() {
    try {
      const meta = await getRecordingMeta();
      if (!meta?.projectId || !meta?.slideNumber) {
        setRecovery(null);
        return;
      }
      const chunks = await getChunks();
      setRecovery(chunks.length ? { ...meta, chunks: chunks.length } : null);
    } catch {
      // ProductionApp will show its own recovery error if storage cannot be read.
    }
  }

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    const sync = () => setBanner(document.querySelector('.recording-flow .recovery-banner'));
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    sync();
    refreshRecovery();
    const timer = window.setInterval(refreshRecovery, 2500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const blockUnsafeRecording = (event) => {
      const button = event.target?.closest?.('.recording-flow .record-button');
      if (!button) return;
      if (!recovery && !document.querySelector('.recording-flow .recovery-banner')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const slide = recovery?.slideNumber || 'pendiente';
      window.alert(`Hay una grabación interrumpida recuperable de la diapositiva ${slide}. Recupérala o descártala antes de iniciar una nueva toma.`);
    };
    document.addEventListener('click', blockUnsafeRecording, true);
    return () => document.removeEventListener('click', blockUnsafeRecording, true);
  }, [recovery]);

  async function discardRecovery() {
    if (busy) return;
    const slide = recovery?.slideNumber || '';
    const confirmed = window.confirm(
      `¿Descartar definitivamente la grabación interrumpida${slide ? ` de la diapositiva ${slide}` : ''}? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await clearRecordingData();
      setRecovery(null);
      window.location.reload();
    } catch (caught) {
      window.alert(caught?.message || 'No se pudo descartar la grabación interrumpida.');
      setBusy(false);
    }
  }

  if (!banner) return null;

  return createPortal(
    <button type="button" className="recovery-discard-button" onClick={discardRecovery} disabled={busy}>
      {busy ? 'Descartando…' : 'Descartar toma'}
    </button>,
    banner,
  );
}
