import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getActiveProject, getProjectTakeMetadata } from './storage';
import './recording-advance.css';

const NAV_KEYS = ['content', 'recording', 'cut', 'library', 'join', 'memes', 'result'];

function clickNav(key) {
  const index = NAV_KEYS.indexOf(key);
  if (index < 0) return false;
  const button = document.querySelectorAll('.production-nav button')[index];
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

export default function RecordingAdvanceManager() {
  const [target, setTarget] = useState(null);
  const [project, setProject] = useState(null);
  const [takes, setTakes] = useState([]);

  async function refresh() {
    const active = await getActiveProject();
    setProject(active || null);
    if (!active?.id) {
      setTakes([]);
      return;
    }
    const rows = await getProjectTakeMetadata(active.id);
    setTakes(rows || []);
  }

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    const sync = () => {
      const flow = document.querySelector('.recording-flow');
      setTarget(flow?.querySelector('.slide-mini-rail') || null);
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    sync();
    refresh().catch(() => {});
    const onChange = () => refresh().catch(() => {});
    window.addEventListener('videosstudio:project-plan-changed', onChange);
    return () => {
      observer.disconnect();
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

  useEffect(() => {
    if (!project?.id || !next || !document.querySelector('.recording-flow')) return;
    const storageKey = `videosstudio:auto-resume:${project.id}`;
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, next.key);
    const timer = window.setTimeout(() => clickNav(next.key), 450);
    return () => window.clearTimeout(timer);
  }, [project?.id, next?.key]);

  if (!target || !next) return null;

  return createPortal(
    <button
      type="button"
      className="recording-continue-button"
      onClick={() => clickNav(next.key)}
      title="Todas las grabaciones están aceptadas. Continúa con el siguiente paso del proyecto."
    >
      {next.label}
    </button>,
    target,
  );
}
