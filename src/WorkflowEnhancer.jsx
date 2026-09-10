import { useEffect, useMemo, useState } from 'react';
import { getActiveProject, getProjectTakes, saveProject } from './storage';
import { getVisualCountsBySlide } from './visualStore';

const NAV_KEYS = ['content', 'recording', 'cut', 'library', 'join', 'memes', 'result'];
const INHERIT = '__inherit__';
const NONE = '__none__';

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

function resolveChoice(value, fallback = '') {
  if (value === NONE) return '';
  if (!value || value === INHERIT) return fallback || '';
  return value;
}

function isActiveCta(cta = '') {
  const normalized = String(cta).toUpperCase();
  return !!normalized && !/TIPO\s*:\s*NINGUNO/.test(normalized) && normalized.trim() !== 'NINGUNO';
}

export default function WorkflowEnhancer() {
  const [project, setProject] = useState(null);
  const [takes, setTakes] = useState([]);
  const [visualCounts, setVisualCounts] = useState({});
  const [view, setView] = useState('');
  const [bridgeNotice, setBridgeNotice] = useState(null);

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
      const slide = stats.slides.find((item) => Number(item.number) === slideNumber);
      const ready = Boolean(project?.productionPlan?.scenes?.[slideNumber]?.ready);
      button.dataset.visualCount = count ? `${count} img` : 'sin img';
      button.dataset.hasUploadedVisual = count ? 'true' : 'false';
      button.classList.toggle('workflow-done', ready);
      const small = button.querySelector('small');
      if (small) {
        const cleanLabel = stats.takeMap[slideNumber]?.cleanedBlob ? 'Video limpio ✓' : 'Falta corte';
        const visualLabel = count
          ? `Visual ${count} img ✓`
          : String(slide?.visual || '').trim() ? 'Visual ✓' : 'Visual —';
        small.textContent = `${cleanLabel} · ${visualLabel}`;
      }
    });
  }, [project, stats, visualCounts, view]);

  useEffect(() => {
    if (view !== 'result') return;
    const cards = [...document.querySelectorAll('.result-cards > div')];
    const values = [
      `${stats.accepted}/${stats.total}`,
      `${stats.cleaned}/${stats.total}`,
      `${stats.mounted}/${stats.total}`,
    ];
    values.forEach((value, index) => {
      const target = cards[index]?.querySelector('strong');
      if (target) target.textContent = value;
      cards[index]?.classList.toggle('ok', Number(value.split('/')[0]) === stats.total);
    });

    const actualMissingVisuals = Math.max(0, stats.total - stats.visuals);
    const audit = document.querySelector('.audit-issues');
    if (audit) {
      const spans = [...audit.querySelectorAll('span')];
      spans.forEach((span) => {
        if (!span.textContent.includes('diapositivas no tienen VISUAL')) return;
        if (!actualMissingVisuals) span.style.display = 'none';
        else {
          span.style.display = '';
          span.textContent = `${actualMissingVisuals} diapositivas no tienen imagen o VISUAL.`;
        }
      });
      const visibleIssues = spans.filter((span) => span.style.display !== 'none');
      audit.style.display = visibleIssues.length ? '' : 'none';
    }
  }, [view, stats]);

  useEffect(() => {
    if (view !== 'join' || !project) return undefined;

    const interceptReady = async (event) => {
      const button = event.target?.closest?.('.join-inspector .primary-button');
      if (!button || !button.textContent.includes('Marcar escena lista')) return;

      const slideNumber = Number(document.querySelector('.join-scene-list button.active > span')?.textContent || 0);
      const slide = project.slides?.find((item) => Number(item.number) === slideNumber);
      const uploadedCount = visualCounts[slideNumber] || 0;
      if (!slide || !uploadedCount || String(slide.visual || '').trim()) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const take = stats.takeMap[slideNumber];
      if (!take?.cleanedBlob) {
        setBridgeNotice({ type: 'error', text: 'Primero guarda el corte limpio de esta diapositiva.' });
        return;
      }

      try {
        const defaults = await window.videosStudio?.library?.getDefaults?.() || {};
        const selects = [...document.querySelectorAll('.join-inspector select')];
        const defaultTransition = resolveChoice(project.productionPlan?.transitionDefault, defaults.transitions || '');
        const transition = resolveChoice(selects[0]?.value, defaultTransition);
        let ctaAsset = '';
        if (isActiveCta(slide.cta)) {
          ctaAsset = resolveChoice(selects[1]?.value, defaults.cta || '');
          if (!ctaAsset) {
            setBridgeNotice({ type: 'error', text: 'Esta diapositiva tiene CTA. Selecciona el video CTA antes de marcarla como lista.' });
            return;
          }
        }

        const scenes = {
          ...(project.productionPlan?.scenes || {}),
          [slideNumber]: {
            ready: true,
            visual: `IMÁGENES CARGADAS: ${uploadedCount}`,
            visualImages: uploadedCount,
            transition,
            ctaAsset,
            updatedAt: Date.now(),
          },
        };
        const nextProject = {
          ...project,
          productionPlan: { ...(project.productionPlan || {}), scenes },
          updatedAt: Date.now(),
        };
        await saveProject(nextProject);
        setProject(nextProject);
        setBridgeNotice({ type: 'success', text: `Diapositiva ${slideNumber} lista con ${uploadedCount} imagen${uploadedCount === 1 ? '' : 'es'} automática${uploadedCount === 1 ? '' : 's'}.` });
        window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));

        const sceneButtons = [...document.querySelectorAll('.join-scene-list button')];
        const currentIndex = sceneButtons.findIndex((row) => Number(row.querySelector(':scope > span')?.textContent || 0) === slideNumber);
        if (currentIndex >= 0 && currentIndex < sceneButtons.length - 1) {
          window.setTimeout(() => sceneButtons[currentIndex + 1]?.click(), 80);
        }
      } catch (caught) {
        setBridgeNotice({ type: 'error', text: caught.message || 'No se pudo marcar la escena como lista.' });
      }
    };

    document.addEventListener('click', interceptReady, true);
    return () => document.removeEventListener('click', interceptReady, true);
  }, [view, project, visualCounts, stats.takeMap]);

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

      {bridgeNotice && (
        <div className={`workflow-bridge-toast ${bridgeNotice.type}`}>
          <span>{bridgeNotice.text}</span>
          <button onClick={() => setBridgeNotice(null)}>×</button>
        </div>
      )}
    </>
  );
}
