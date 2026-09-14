import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getActiveProject, getProjectTakeMetadata } from './storage';
import { requestProductionNavigation, viewLabel } from './navigation';
import './recording-advance.css';

export default function RecordingAdvanceManager() {
  const [target, setTarget] = useState(null);
  const [project, setProject] = useState(null);
  const [takes, setTakes] = useState([]);
  const [navigating, setNavigating] = useState(false);
  const [notice, setNotice] = useState('');
  const mountedRef = useRef(true);

  async function refresh() {
    const active = await getActiveProject();
    if (!mountedRef.current) return;
    setProject(active || null);
    if (!active?.id) {
      setTakes([]);
      return;
    }
    const rows = await getProjectTakeMetadata(active.id);
    if (mountedRef.current) setTakes(rows || []);
  }

  useEffect(() => {
    mountedRef.current = true;
    const root = document.getElementById('root');
    if (!root) return undefined;
    const sync = () => {
      const flow = document.querySelector('.recording-flow');
      const stableReview = Boolean(flow?.querySelector('.status-stopped'));
      const hasRecovery = Boolean(flow?.querySelector('.recovery-banner'));
      setTarget(stableReview && !hasRecovery ? flow?.querySelector('.record-actions') || null : null);
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    sync();
    refresh().catch(() => {});
    const timer = window.setInterval(() => refresh().catch(() => {}), 2500);
    const onChange = () => refresh().catch(() => {});
    window.addEventListener('videosstudio:project-plan-changed', onChange);
    return () => {
      mountedRef.current = false;
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener('videosstudio:project-plan-changed', onChange);
    };
  }, []);

  const progress = useMemo(() => {
    const slides = project?.slides || [];
    const takeMap = Object.fromEntries(takes.map((take) => [Number(take.slideNumber), take]));
    const total = slides.length;
    const accepted = slides.filter((slide) => takeMap[slide.number]?.accepted).length;
    const cleaned = slides.filter((slide) => takeMap[slide.number]?.hasCleanedBlob).length;
    const mounted = slides.filter((slide) => project?.productionPlan?.scenes?.[slide.number]?.ready).length;
    return { total, accepted, cleaned, mounted };
  }, [project, takes]);

  const next = useMemo(() => {
    if (!progress.total || progress.accepted < progress.total) return null;
    if (progress.cleaned < progress.total) return { key: 'cut', label: 'Continuar a Corte →' };
    if (progress.mounted < progress.total) return { key: 'join', label: 'Continuar a Unión →' };
    return { key: 'result', label: 'Ver Resultado →' };
  }, [progress]);

  async function goNext({ automatic = false } = {}) {
    if (!next || navigating) return false;
    setNavigating(true);
    if (!automatic) setNotice('');
    try {
      const result = await requestProductionNavigation(next.key, { timeoutMs: automatic ? 8000 : 6000 });
      if (result.ok) return true;
      if (!automatic && mountedRef.current) {
        setNotice(`No se pudo abrir ${viewLabel(next.key)}. Intenta nuevamente; tus grabaciones siguen guardadas.`);
      }
      return false;
    } finally {
      if (mountedRef.current) setNavigating(false);
    }
  }

  useEffect(() => {
    if (!project?.id || !next || !target || !document.querySelector('.recording-flow')) return undefined;
    const storageKey = `videosstudio:auto-resume:${project.id}`;
    if (sessionStorage.getItem(storageKey) === 'done') return undefined;

    let cancelled = false;
    let retryTimer = 0;
    const attempt = async () => {
      if (cancelled) return;
      const ok = await goNext({ automatic: true });
      if (cancelled) return;
      if (ok) {
        sessionStorage.setItem(storageKey, 'done');
        return;
      }
      retryTimer = window.setTimeout(attempt, 1200);
    };

    const startTimer = window.setTimeout(attempt, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      window.clearTimeout(retryTimer);
    };
  }, [project?.id, next?.key, target]);

  if (!target || !next) return null;

  return createPortal(
    <>
      <button
        type="button"
        className="recording-continue-button"
        onClick={() => goNext()}
        disabled={navigating}
        title="Todas las grabaciones están aceptadas. Continúa con el siguiente paso del proyecto."
      >
        {navigating ? 'Abriendo…' : next.label}
      </button>
      {notice && <span className="recording-advance-notice">{notice}</span>}
    </>,
    target,
  );
}
