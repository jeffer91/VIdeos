import { useEffect, useMemo, useState } from 'react';
import { getActiveProject, getProjectTakes } from './storage';
import { getVisualCountsBySlide } from './visualStore';

const NAV_KEYS = ['content', 'recording', 'cut', 'library', 'join', 'memes', 'result'];

function detectView() {
  if (document.querySelector('.content-flow')) return 'content';
  if (document.querySelector('.recording-flow')) return 'recording';
  if (document.querySelector('.cut-flow')) return 'cut';
  if (document.querySelector('.library-flow')) return 'library';
  if (document.querySelector('.join-flow')) return 'join';
  if (document.querySelector('.memes-flow')) return 'memes';
  if (document.querySelector('.result-flow')) return 'result';
  return '';
}

function clickNav(key) {
  const index = NAV_KEYS.indexOf(key);
  if (index < 0) return;
  document.querySelectorAll('.production-nav button')[index]?.click();
}

export default function WorkflowEnhancer() {
  const [project, setProject] = useState(null);
  const [takes, setTakes] = useState([]);
  const [visualCounts, setVisualCounts] = useState({});
  const [view, setView] = useState('');

  async function refreshData() {
    const active = await getActiveProject();
    setProject(active || null);
    if (!active?.id) {
      setTakes([]);
      setVisualCounts({});
      return;
    }
    const [rows, counts] = await Promise.all([
      getProjectTakes(active.id),
      getVisualCountsBySlide(active.id),
    ]);
    setTakes(rows || []);
    setVisualCounts(counts || {});
  }

  useEffect(() => {
    refreshData().catch(() => {});
    const timer = window.setInterval(() => refreshData().catch(() => {}), 1800);
    const onChange = () => refreshData().catch(() => {});
    window.addEventListener('videosstudio:visuals-changed', onChange);
    window.addEventListener('videosstudio:project-plan-changed', onChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('videosstudio:visuals-changed', onChange);
      window.removeEventListener('videosstudio:project-plan-changed', onChange);
    };
  }, []);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    let frame = 0;
    const syncView = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setView(detectView()));
    };
    const observer = new MutationObserver(syncView);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    root.addEventListener('click', syncView, true);
    syncView();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener('click', syncView, true);
    };
  }, []);

  const stats = useMemo(() => {
    const slides = project?.slides || [];
    const total = slides.length;
    const takeMap = Object.fromEntries(takes.map((take) => [Number(take.slideNumber), take]));
    const accepted = slides.filter((slide) => takeMap[slide.number]?.accepted).length;
    const cleaned = slides.filter((slide) => takeMap[slide.number]?.cleanedBlob).length;
    const mounted = slides.filter((slide) => project?.productionPlan?.scenes?.[slide.number]?.ready).length;
    const visuals = slides.filter((slide) => (visualCounts[slide.number] || 0) > 0 || String(slide.visual || '').trim()).length;
    const memes = project?.productionPlan?.memes?.length || 0;
    const denominator = total ? 1 + total * 4 : 1;
    const completedUnits = project ? 1 + accepted + cleaned + visuals + mounted : 0;
    const overall = total ? Math.round((completedUnits / denominator) * 100) : 0;
    return { total, accepted, cleaned, mounted, visuals, memes, overall, takeMap, slides };
  }, [project, takes, visualCounts]);

  useEffect(() => {
    const app = document.querySelector('.production-app');
    if (!app) return;
    app.style.setProperty('--project-progress', `${stats.overall}%`);
    app.dataset.workflowView = view || '';

    const buttons = [...document.querySelectorAll('.production-nav button')];
    const progress = [
      project ? '✓' : '',
      stats.total ? `${stats.accepted}/${stats.total}` : '',
      stats.total ? `${stats.cleaned}/${stats.total}` : '',
      '',
      stats.total ? `${stats.mounted}/${stats.total}` : '',
      stats.memes ? String(stats.memes) : '',
      stats.total ? `${stats.overall}%` : '',
    ];
    buttons.forEach((button, index) => {
      button.dataset.step = String(index + 1);
      button.dataset.progress = progress[index] || '';
      button.title = progress[index]
        ? `${button.textContent.trim()} · ${progress[index]}`
        : button.textContent.trim();
    });

    document.querySelectorAll('.join-scene-list button').forEach((button) => {
      const slideNumber = Number(button.querySelector(':scope > span')?.textContent || 0);
      const count = visualCounts[slideNumber] || 0;
      button.dataset.visualCount = count ? `${count} img` : 'sin img';
      button.dataset.hasUploadedVisual = count ? 'true' : 'false';
    });
  }, [project, stats, visualCounts, view]);

  const recommendation = useMemo(() => {
    if (!project || !stats.total) return null;
    if (stats.accepted < stats.total) return { key: 'recording', label: `${stats.total - stats.accepted} por grabar` };
    if (stats.cleaned < stats.total) return { key: 'cut', label: `${stats.total - stats.cleaned} por limpiar` };
    if (stats.visuals < stats.total) return { key: 'join', label: `${stats.total - stats.visuals} sin visual` };
    if (stats.mounted < stats.total) return { key: 'join', label: `${stats.total - stats.mounted} por montar` };
    return { key: 'result', label: 'Revisar resultado' };
  }, [project, stats]);

  function goNextPending() {
    if (!project) return;
    if (view === 'cut') {
      const index = stats.slides.findIndex((slide) => stats.takeMap[slide.number]?.accepted && !stats.takeMap[slide.number]?.cleanedBlob);
      if (index >= 0) document.querySelectorAll('.cut-list button')[index]?.click();
      return;
    }
    if (view === 'join') {
      const index = stats.slides.findIndex((slide) => {
        const hasClean = Boolean(stats.takeMap[slide.number]?.cleanedBlob);
        const hasVisual = (visualCounts[slide.number] || 0) > 0 || String(slide.visual || '').trim();
        const mounted = Boolean(project.productionPlan?.scenes?.[slide.number]?.ready);
        return hasClean && (!hasVisual || !mounted);
      });
      if (index >= 0) document.querySelectorAll('.join-scene-list button')[index]?.click();
      return;
    }
    if (recommendation) clickNav(recommendation.key);
  }

  if (!project || !stats.total) return null;

  const showNext = ['cut', 'join', 'result'].includes(view) && recommendation;

  return (
    <>
      <div className="workflow-overall-pill" title="Progreso global: contenido + grabación + corte + visuales + montaje">
        <span className="workflow-ring" style={{ '--value': `${stats.overall * 3.6}deg` }}><b>{stats.overall}%</b></span>
        <span><small>Proyecto</small><strong>{recommendation?.label || 'En progreso'}</strong></span>
        {showNext && <button onClick={goNextPending}>Siguiente pendiente →</button>}
      </div>

      {view === 'result' && (
        <div className="workflow-result-summary">
          <div><span>Grabadas</span><strong>{stats.accepted}/{stats.total}</strong></div>
          <div><span>Limpias</span><strong>{stats.cleaned}/{stats.total}</strong></div>
          <div><span>Con visual</span><strong>{stats.visuals}/{stats.total}</strong></div>
          <div><span>Montadas</span><strong>{stats.mounted}/{stats.total}</strong></div>
        </div>
      )}
    </>
  );
}
