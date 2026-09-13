import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getActiveProject,
  getProjectTakes,
  getTemplateMetadataMap,
  getTemplatePreferences,
} from './storage';
import { getVisualSettings, listVisualAssets } from './visualStore';
import { finalVideoFilename } from './finalRenderer';
import { renderProductionVideo } from './productionRenderer';
import './final-render.css';

const INHERIT = '__inherit__';
const NONE = '__none__';

function resolveChoice(value, fallback = '') {
  if (value === NONE) return '';
  if (!value || value === INHERIT) return fallback || '';
  return value;
}

function isActiveCta(cta = '') {
  const normalized = String(cta).toUpperCase();
  return !!normalized && !/TIPO\s*:\s*NINGUNO/.test(normalized) && normalized.trim() !== 'NINGUNO';
}

function rowsToMap(rows = []) {
  return Object.fromEntries(rows.map((take) => [Number(take.slideNumber), take]));
}

async function readLibraryBlob(path) {
  if (!path) return null;
  const api = window.videosStudio?.library;
  if (!api?.readBytes) throw new Error('El render final necesita la versión de escritorio actualizada.');
  const item = await api.readBytes({ path });
  if (!item?.data) throw new Error(`No se pudo leer el recurso ${path}.`);
  return new Blob([item.data], { type: item.type || 'application/octet-stream' });
}

export default function FinalRenderManager() {
  const [target, setTarget] = useState(null);
  const [project, setProject] = useState(null);
  const [takes, setTakes] = useState({});
  const [defaults, setDefaults] = useState({});
  const [rendering, setRendering] = useState(false);
  const [renderState, setRenderState] = useState({ progress: 0, phase: 'idle', detail: '' });
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
    return () => window.removeEventListener('videosstudio:project-plan-changed', onChange);
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

  async function buildRenderPlan() {
    if (!project) throw new Error('No hay un proyecto activo.');
    const api = window.videosStudio?.library;
    if (!api?.readBytes) throw new Error('Actualiza Videos Studio para usar el compositor final.');

    const [templatePreferences, templateMetadata] = await Promise.all([
      getTemplatePreferences(project.id),
      getTemplateMetadataMap(),
    ]);
    const productionPlan = project.productionPlan || {};
    const transitionDefault = resolveChoice(productionPlan.transitionDefault, defaults.transitions || '');
    const introPath = resolveChoice(productionPlan.intro, defaults.intros || '');
    const endingPath = resolveChoice(productionPlan.ending, defaults.endings || '');
    const blobCache = new Map();

    const loadPath = async (path) => {
      if (!path) return null;
      if (!blobCache.has(path)) blobCache.set(path, readLibraryBlob(path));
      return blobCache.get(path);
    };

    const scenes = [];
    for (const slide of project.slides || []) {
      const take = takes[slide.number];
      if (!take?.cleanedBlob) throw new Error(`Falta el corte limpio de la diapositiva ${slide.number}.`);
      if (take.mode === 'audio') throw new Error(`La diapositiva ${slide.number} es solo audio y no puede componerse como escena de video.`);

      const [visuals, visualSettings] = await Promise.all([
        listVisualAssets(project.id, slide.number),
        getVisualSettings(project.id, slide.number),
      ]);
      if (!visuals.length) throw new Error(`La diapositiva ${slide.number} no tiene imágenes cargadas.`);

      const templatePath = templatePreferences?.perSlide?.[slide.number] || templatePreferences?.defaultPath || '';
      const transitionPath = resolveChoice(productionPlan.transitions?.[slide.number], transitionDefault);
      const ctaPath = isActiveCta(slide.cta)
        ? resolveChoice(productionPlan.ctaAssets?.[slide.number], defaults.cta || '')
        : '';
      if (isActiveCta(slide.cta) && !ctaPath) throw new Error(`La diapositiva ${slide.number} tiene CTA pero no tiene clip CTA asignado.`);

      const templateBlob = templatePath ? await loadPath(templatePath) : null;
      if (transitionPath) await loadPath(transitionPath);
      if (ctaPath) await loadPath(ctaPath);
      const sceneMemes = (productionPlan.memes || []).filter((item) => Number(item.slideNumber) === Number(slide.number));
      for (const meme of sceneMemes) await loadPath(meme.assetPath);

      scenes.push({
        slide,
        videoBlob: take.cleanedBlob,
        durationSeconds: Math.max(.05, Number(take.cleanedDurationMs || take.durationMs || 0) / 1000),
        visuals,
        visualSettings,
        templateBlob,
        templateMetadata: templatePath ? templateMetadata?.[templatePath] || null : null,
        theme: productionPlan.theme || 'blue',
        transitionPath,
        ctaPath,
        memes: sceneMemes,
      });
    }

    if (introPath) await loadPath(introPath);
    if (endingPath) await loadPath(endingPath);
    const loaded = await Promise.all([...blobCache.entries()].map(async ([path, promise]) => [path, await promise]));
    const resourceBlobs = new Map(loaded);

    return {
      scenes,
      introBlob: introPath ? resourceBlobs.get(introPath) : null,
      endingBlob: endingPath ? resourceBlobs.get(endingPath) : null,
      resourceBlobs,
      memeBlobs: resourceBlobs,
    };
  }

  async function renderFinalMp4() {
    if (!project || rendering) return;
    setError('');
    setOutput(null);

    if (readiness.missingClean.length) {
      setError(`Faltan ${readiness.missingClean.length} cortes limpios antes de generar el MP4.`);
      return;
    }
    if (readiness.audioOnly.length) {
      setError('El render final requiere tomas de video. Hay escenas guardadas como solo audio.');
      return;
    }
    if (readiness.unmounted.length) {
      setError(`Faltan ${readiness.unmounted.length} escenas por revisar en Unión antes del render final.`);
      return;
    }

    setRendering(true);
    setRenderState({ progress: 0, phase: 'loading', detail: 'Preparando proyecto' });
    try {
      const plan = await buildRenderPlan();
      const blob = await renderProductionVideo(plan, setRenderState);
      setOutput(blob);
      setRenderState({ progress: 1, phase: 'done', detail: 'MP4 final listo' });
    } catch (caught) {
      console.error(caught);
      setError(caught?.message || 'No se pudo generar el MP4 final.');
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
  const phaseLabel = renderState.phase === 'scene'
    ? renderState.detail || 'Componiendo escenas'
    : renderState.phase === 'resources'
      ? `Preparando ${renderState.detail || 'recursos'}`
      : renderState.phase === 'intro'
        ? 'Preparando intro'
        : renderState.phase === 'ending'
          ? 'Preparando ending'
          : renderState.phase === 'joining'
            ? 'Uniendo producción'
            : renderState.phase === 'done'
              ? 'MP4 final listo'
              : renderState.detail || 'Preparando motor';

  const blocked = rendering
    || readiness.missingClean.length > 0
    || readiness.audioOnly.length > 0
    || readiness.unmounted.length > 0;

  return createPortal(
    <section className="production-card final-render-panel">
      <div className="final-render-heading">
        <div>
          <span className="eyebrow">EXPORTACIÓN FINAL</span>
          <strong>Generar video completo</strong>
          <small>Renderiza plantilla, cámara, imágenes, datos, intro, transiciones, CTA, video memes y ending en un MP4 Full HD.</small>
        </div>
        <button className="primary-button" onClick={renderFinalMp4} disabled={blocked}>
          {rendering ? `${percent}%` : output ? 'Generar de nuevo' : 'Generar MP4 final'}
        </button>
      </div>

      <div className="final-render-status">
        <span className={readiness.missingClean.length ? 'warn' : 'ok'}>{readiness.slides.length - readiness.missingClean.length}/{readiness.slides.length} videos limpios</span>
        <span className={readiness.unmounted.length ? 'warn' : 'ok'}>{readiness.slides.length - readiness.unmounted.length}/{readiness.slides.length} escenas revisadas</span>
        {readiness.audioOnly.length > 0 && <span className="warn">{readiness.audioOnly.length} solo audio</span>}
      </div>

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
            <strong>MP4 final generado</strong>
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
