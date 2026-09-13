import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

function isRecordingBusy() {
  return Boolean(document.querySelector(
    '.status-recording, .status-paused, .status-saving, .status-detecting, .rec-indicator',
  ));
}

function isProductionBusy() {
  if (isRecordingBusy()) return true;
  return [...document.querySelectorAll('button:disabled')].some((button) => (
    /Procesando|Guardando|Detectando|Generando|Exportando|Renderizando/i.test(button.textContent || '')
  ));
}

export default function UpdateEnhancer() {
  const [headerTarget, setHeaderTarget] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [status, setStatus] = useState({ state: 'idle' });
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    const sync = () => setHeaderTarget(document.querySelector('.production-header'));
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.videosStudio?.app?.getInfo?.().then(setAppInfo).catch(() => {});
    const unsubscribe = window.videosStudio?.updates?.onStatus?.((next) => {
      setStatus(next || { state: 'idle' });
      if (next?.state === 'error') setNotice(next.message || 'No se pudo comprobar la actualización.');
      if (next?.state === 'downloaded') setNotice('Actualización lista. Puedes instalarla cuando termines de trabajar.');
    });
    return () => unsubscribe?.();
  }, []);

  const label = useMemo(() => {
    if (status.state === 'downloading') return `↓ ${Math.round(Number(status.percent) || 0)}%`;
    if (status.state === 'available') return 'Nueva versión';
    if (status.state === 'downloaded') return 'Actualizar';
    if (status.state === 'checking') return 'Buscando…';
    return appInfo?.version ? `v${appInfo.version}` : '';
  }, [status, appInfo]);

  async function checkUpdates() {
    setNotice('');
    try {
      const result = await window.videosStudio?.updates?.check?.();
      if (result?.reason === 'development') {
        setNotice('Las actualizaciones automáticas se comprueban en la versión instalada.');
      }
      if (result?.reason === 'updater-unavailable') {
        setNotice('Esta ejecución no tiene cargado el actualizador. La app puede seguir funcionando; vuelve a instalar o actualiza las dependencias para recuperar las actualizaciones automáticas.');
      }
    } catch {
      setNotice('No se pudo comprobar la actualización.');
    }
  }

  async function installUpdate() {
    if (isProductionBusy()) {
      setNotice('Finaliza el proceso actual antes de reiniciar Videos Studio para actualizar.');
      return;
    }

    const confirmed = window.confirm(
      'Videos Studio se cerrará y volverá a abrir con la nueva versión. Asegúrate de haber guardado cualquier cambio de contenido que aún no hayas confirmado. ¿Actualizar ahora?',
    );
    if (!confirmed) return;

    try {
      const result = await window.videosStudio?.updates?.install?.();
      if (result?.reason === 'updater-unavailable') {
        setNotice('El actualizador no está disponible en esta ejecución.');
      }
    } catch {
      setNotice('No se pudo iniciar la actualización.');
    }
  }

  if (!headerTarget || !appInfo) return null;

  return createPortal(
    <div
      className="update-command"
      style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}
    >
      <button
        type="button"
        onClick={status.state === 'downloaded' ? installUpdate : checkUpdates}
        title={status.state === 'downloaded' ? 'Reiniciar e instalar actualización' : 'Buscar actualizaciones'}
        style={{
          border: '1px solid #d6dfeb',
          background: status.state === 'downloaded' ? '#effdf5' : '#fff',
          color: status.state === 'downloaded' ? '#13713d' : '#5a6b80',
          borderRadius: 999,
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 800,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {label || 'Versión'}
      </button>
      {notice && (
        <div
          style={{
            position: 'fixed',
            right: 18,
            bottom: 18,
            zIndex: 10001,
            maxWidth: 390,
            padding: '11px 14px',
            border: '1px solid #d8e2ef',
            borderRadius: 12,
            background: '#fff',
            color: '#34465d',
            boxShadow: '0 12px 30px rgba(16, 32, 51, .14)',
            fontSize: 12,
            fontWeight: 700,
          }}
          onClick={() => setNotice('')}
        >
          {notice}
        </div>
      )}
    </div>,
    headerTarget,
  );
}
