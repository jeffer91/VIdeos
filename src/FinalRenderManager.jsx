import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getActiveProject, getProjectTakes } from './storage';
import { finalVideoFilename, renderCleanSceneSequence } from './finalRenderer';
import './final-render.css';

const INHERIT = '__inherit__';
const NONE = '__none__';

function resolveChoice(value, fallback = '') {
  if (value === NONE) return '';
  if (!value || value === INHERIT) return fallback || '';
  return value;
}

function rowsToMap(rows = []) {
  return Object.fromEntries(rows.map((take) => [Number(take.slideNumber), take]));
}

export default function FinalRenderManager() {
  const [target, setTarget] = useState(null);
  const [project, setProject] = useState(null);
  const [takes, setTakes] = useState({});
  const [defaults, setDefaults] = useState({});
  const [rendering, setRendering] = useState(false);
  const [renderState, setRenderState] = useState({ progress: 0, phase: 'idle', current: 0, total: 0 });
  const [output, setOutput] = useState(null);
  const [outputUrl, setOutputUrl] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    const active = await getActiveProject();
    if (!active?.id) {
      setProject(null);
      setTakes({});
      return;
    }
    const [rows, libraryDefaults] = await Promise.all([
      getProjectTakes(active.id),
      window.videosStudio?.library?.getDefaults?.() || Promise.resolve({}),
    ]);
    setProject(active);
    setTakes(rowsToMap(rows));
    setDefaults(libraryDefaults || {});
  }

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    const sync = () => setTarget(document.querySelector('.result-flow'));
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!target) return undefined;
    refresh().catch(() => setError('No se pudo revisar el proyecto antes del render.'));
    const onChange = () => refresh().catch(() => {});
    window.addEventListener('videosstudio:project-plan-changed', onChange);
    const timer = window.setInterval(onChange, 8000);
    return () => {
      window.removeEventListener('videosstudio:project-plan-changed', onChange);
      window.clearInterval(timer);
    };
  }, [target]);

  useEffect(() => {
    if (!output) {
      setOutputUrl('');
      return undefined;
    }
    const next = URL.createObjectURL(output);
    setOutputUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [output]);

  const readiness = useMemo(() => {
    const slides = project?.slides || [];
    const missingClean = slides.filter((slide) => !takes[slide.number]?.cleanedBlob);
    const audioOnly = slides.filter((slide) => takes[slide.number]?.cleanedBlob && takes[slide.number]?.mode === 'audio');
    const unmounted = slides.filter((slide) => !project?.productionPlan?.scenes?.[slide.number]?.ready);
    return { slides, missingClean, audioOnly, unmounted };
  }, [project, takes]);

  const advancedResources = useMemo(() => {
    if (!project) return [];
    const plan = project.productionPlan || {};
    const resources = [];
    if (resolveChoice(plan.intro, defaults.intros)) resources.push('intro');
    if (resolveChoice(plan.ending, defaults.endings)) resources.push('ending');
    if (resolveChoice(plan.transitionDefault, defaults.transitions)) resources.push('transiciones');
    if (Object.values(plan.transitions || {}).some((value) => resolveChoice(value, defaults.transitions))) resources.push('transiciones por escena');
    if (Object.values(plan.ctaAssets || {}).some((value) => resolveChoice(value, defaults.cta))) resources.push('CTA en video');
    if ((plan.memes || []).length) resources.push('video memes');
    return [...new Set(resources)];
  }, [project, defaults]);

  async function renderBaseMp4() {
    if (!project || rendering) return;
    setError('');
    setOutput(null);

    if (readiness.missingClean.length) {
      setError(`Faltan ${readiness.missingClean.length} cortes limpios antes de generar el MP4.`);
      return;
    }
    if (readiness.audioOnly.length) {
      setError('El render MP4 base todavía requiere tomas de video. Hay escenas guardadas como solo audio.');
      return;
    }

    const blobs = readiness.slides.map((slide) => takes[slide.number]?.cleanedBlob);
    setRendering(true);
    setRenderState({ progress: 0, phase: 'loading', current: 0, total: blobs.length });
    try {
      const blob = await renderCleanSceneSequence(blobs, setRenderState);
      setOutput(blob);
      setRenderState({ progress: 1, phase: 'done', current: blobs.length, total: blobs.length });
    } catch (caught) {
      console.error(caught);
      setError(caught?.message || 'No se pudo generar el MP4.');
    } finally {
      setRendering(false);
    }
  }

  function downloadOutput() {
    if (!outputUrl || !project) return;
    const link = document.createElement('a');
    link.href = outputUrl;
    link.download = finalVideoFilename(project);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (!target || !project) return null;

  const percent = Math.round((Number(renderState.progress) || 0) * 100);
  const phaseLabel = renderState.phase === 'normalizing'
    ? `Preparando escena ${renderState.current}/${renderState.total}`
    : renderState.phase === 'joining'
      ? 'Uniendo escenas'
      : renderState.phase === 'done'
        ? 'MP4 listo'
        : 'Preparando motor';

  return createPortal(
    <section className="production-card final-render-panel">
      <div className="final-render-heading">
        <div>
          <span className="eyebrow">EXPORTACIÓN MP4</span>
          <strong>Generar video de escenas limpias</strong>
          <small>Une en orden todas las tomas limpias y crea un MP4 Full HD reproducible.</small>
        </div>
        <button className="primary-button" onClick={renderBaseMp4} disabled={rendering || readiness.missingClean.length > 0 || readiness.audioOnly.length > 0}>
          {rendering ? `${percent}%` : output ? 'Generar de nuevo' : 'Generar MP4'}
        </button>
      </div>

      <div className="final-render-status">
        <span className={readiness.missingClean.length ? 'warn' : 'ok'}>{readiness.slides.length - readiness.missingClean.length}/{readiness.slides.length} videos limpios</span>
        <span className={readiness.unmounted.length ? 'warn' : 'ok'}>{readiness.slides.length - readiness.unmounted.length}/{readiness.slides.length} escenas revisadas</span>
        {readiness.audioOnly.length > 0 && <span className="warn">{readiness.audioOnly.length} solo audio</span>}
      </div>

      {advancedResources.length > 0 && (
        <div className="final-render-warning">
          <strong>Render base:</strong> este MP4 ya une las escenas limpias. Los recursos avanzados configurados ({advancedResources.join(', ')}) todavía no se incrustan en este render y deben integrarse en la siguiente fase del motor final.
        </div>
      )}

      {(rendering || output) && (
        <div className="final-render-progress">
          <div><i style={{ width: `${percent}%` }} /></div>
          <span>{phaseLabel} · {percent}%</span>
        </div>
      )}

      {output && (
        <div className="final-render-output">
          <video src={outputUrl} controls playsInline />
          <div>
            <strong>MP4 generado correctamente</strong>
            <span>{(output.size / 1024 / 1024).toFixed(1)} MB</span>
            <button className="accept-button" onClick={downloadOutput}>Descargar MP4</button>
          </div>
        </div>
      )}

      {error && <div className="final-render-error">{error}</div>}
    </section>,
    target,
  );
}
