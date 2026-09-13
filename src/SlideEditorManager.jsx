import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  deleteSlideTake,
  getActiveProject,
  getChunks,
  getProjectTakes,
  getRecordingMeta,
  getTemplatePreferences,
  saveProject,
  saveSlideTake,
  setTemplatePreferences,
} from './storage';
import { removeVisualSlideAndShift } from './visualStore';
import './slide-editor.css';

function isRecordingBusy() {
  return Boolean(document.querySelector(
    '.status-recording, .status-paused, .status-saving, .status-detecting, .rec-indicator',
  ));
}

function currentSlideNumberFromDom() {
  const marker = document.querySelector('.recording-flow .slide-flow-header span')?.textContent || '';
  return Number(marker.match(/DIAPOSITIVA\s+(\d+)/i)?.[1] || 0);
}

function canonicalType(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function blockType(value = '') {
  return canonicalType(String(value).match(/^\s*TIPO\s*:\s*([^\n]+)/im)?.[1] || '');
}

function normalizePoints(value = '') {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `- ${line.replace(/^[-•·▪◦●*]\s*/u, '').replace(/^\d{1,2}[.)]\s+/, '').trim()}`)
    .join('\n');
}

function pointLines(value = '', prefix = 'CUERPO') {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => `${prefix}_${index + 1}=${line.replace(/^[-•·▪◦●*]\s*/u, '').trim()}`)
    .join('\n');
}

function visualLines(value = '') {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let match = line.match(/^TIPO\s*:\s*(.*)$/i);
      if (match) return `VISUAL_TIPO=${canonicalType(match[1])}`;
      match = line.match(/^DESCRIPCI[ÓO]N\s*:\s*(.*)$/i);
      if (match) return `VISUAL_DESCRIPCION=${match[1].trim()}`;
      match = line.match(/^DATO\s*(\d+)\s*:\s*(.*)$/i);
      if (match) return `VISUAL_DATO_${match[1]}=${match[2].trim()}`;
      return line;
    })
    .join('\n');
}

function ctaLines(value = '') {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let match = line.match(/^TIPO\s*:\s*(.*)$/i);
      if (match) return `CTA_TIPO=${canonicalType(match[1])}`;
      match = line.match(/^TEXTO\s*:\s*(.*)$/i);
      if (match) return `CTA_TEXTO=${match[1].trim()}`;
      return line;
    })
    .join('\n');
}

function serializeSlide(slide) {
  return [
    `===DIAPOSITIVA ${slide.number}===`,
    '',
    '===GANCHO===',
    slide.hook || '',
    '',
    '===TITULO===',
    slide.title || '',
    '',
    '===CUERPO===',
    pointLines(slide.body, 'CUERPO'),
    '',
    '===CONTENIDO===',
    pointLines(slide.content, 'CONTENIDO'),
    '',
    '===LECTURA===',
    slide.reading || '',
    '===FIN_LECTURA===',
    '',
    '===VISUAL===',
    visualLines(slide.visual),
    '',
    '===CTA===',
    ctaLines(slide.cta),
    '',
    `===FIN_DIAPOSITIVA ${slide.number}===`,
  ].join('\n');
}

function serializeProject(slides = []) {
  return slides.map(serializeSlide).join('\n\n');
}

function normalizedSlide(oldSlide, draft) {
  const body = normalizePoints(draft.body);
  const content = normalizePoints(draft.content);
  const visual = String(draft.visual || '').trim();
  const cta = String(draft.cta || '').trim();
  const visualType = blockType(visual);
  const ctaType = blockType(cta);
  return {
    ...oldSlide,
    hook: String(draft.hook || '').trim(),
    title: String(draft.title || '').trim(),
    body,
    content,
    reading: String(draft.reading || '').trim(),
    visual,
    cta,
    visualType,
    ctaType,
    validation: {
      ...(oldSlide.validation || {}),
      hook: Boolean(String(draft.hook || '').trim()),
      title: Boolean(String(draft.title || '').trim()),
      body: Boolean(body),
      content: Boolean(content),
      reading: Boolean(String(draft.reading || '').trim()),
      visual: Boolean(visual),
      cta: Boolean(ctaType && ctaType !== 'NINGUNO'),
      bodyBulleted: Boolean(body),
      contentBulleted: Boolean(content),
      readingWords: String(draft.reading || '').trim().split(/\s+/).filter(Boolean).length,
    },
  };
}

function sameField(a, b, field) {
  return String(a?.[field] || '').trim() === String(b?.[field] || '').trim();
}

function remapIndexedObject(source = {}, removedNumber) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    const number = Number(key);
    if (!Number.isFinite(number) || number === removedNumber) continue;
    result[number > removedNumber ? number - 1 : number] = value;
  }
  return result;
}

function remapTemplatePreferences(preferences = {}, removedNumber) {
  const perSlide = {};
  for (const [key, value] of Object.entries(preferences.perSlide || {})) {
    const number = Number(key);
    if (!Number.isFinite(number) || number === removedNumber) continue;
    perSlide[number > removedNumber ? number - 1 : number] = value;
  }
  return { ...preferences, perSlide };
}

async function assertNoRecoverableRecording(projectId) {
  const [meta, chunks] = await Promise.all([getRecordingMeta(), getChunks()]);
  if (meta?.projectId === projectId && chunks?.length) {
    throw new Error('Hay una grabación interrumpida recuperable. Recupérala o descártala antes de editar la estructura del video.');
  }
}

export default function SlideEditorManager() {
  const [target, setTarget] = useState(null);
  const [slideNumber, setSlideNumber] = useState(0);
  const [project, setProject] = useState(null);
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    const sync = () => {
      const header = document.querySelector('.recording-flow .slide-flow-header');
      setTarget(header?.querySelector(':scope > div') || null);
      setSlideNumber(currentSlideNumberFromDom());
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    sync();
    return () => observer.disconnect();
  }, []);

  const slide = useMemo(
    () => project?.slides?.find((item) => Number(item.number) === Number(slideNumber)) || null,
    [project, slideNumber],
  );

  async function openEditor() {
    if (busy || isRecordingBusy()) {
      setError('Finaliza o pausa fuera de la toma antes de editar esta diapositiva.');
      return;
    }
    try {
      const active = await getActiveProject();
      const selected = active?.slides?.find((item) => Number(item.number) === Number(slideNumber));
      if (!active?.id || !selected) throw new Error('No se pudo encontrar la diapositiva actual.');
      setProject(active);
      setDraft({
        hook: selected.hook || '',
        title: selected.title || '',
        body: selected.body || '',
        content: selected.content || '',
        reading: selected.reading || '',
        visual: selected.visual || '',
        cta: selected.cta || '',
      });
      setError('');
      setOpen(true);
    } catch (caught) {
      setError(caught?.message || 'No se pudo abrir el editor.');
    }
  }

  async function saveChanges() {
    if (!project || !slide || !draft || busy) return;
    if (!String(draft.title || '').trim()) return setError('El título no puede quedar vacío.');
    if (!normalizePoints(draft.body)) return setError('CUERPO necesita al menos un punto.');
    if (!normalizePoints(draft.content)) return setError('CONTENIDO necesita al menos un punto.');

    setBusy(true);
    setError('');
    try {
      await assertNoRecoverableRecording(project.id);
      const nextSlide = normalizedSlide(slide, draft);
      const readingChanged = !sameField(slide, nextSlide, 'reading');
      const ctaChanged = !sameField(slide, nextSlide, 'cta');
      const sceneChanged = ['title', 'body', 'content', 'visual', 'cta'].some((field) => !sameField(slide, nextSlide, field));
      const nextSlides = project.slides.map((item) => Number(item.number) === Number(slide.number) ? nextSlide : item);
      const plan = { ...(project.productionPlan || {}) };
      const scenes = { ...(plan.scenes || {}) };
      const ctaAssets = { ...(plan.ctaAssets || {}) };
      let memes = [...(plan.memes || [])];

      if (sceneChanged || readingChanged) delete scenes[slide.number];
      if (ctaChanged) delete ctaAssets[slide.number];
      if (readingChanged) memes = memes.filter((item) => Number(item.slideNumber) !== Number(slide.number));

      if (readingChanged) {
        const takes = await getProjectTakes(project.id);
        const take = takes.find((item) => Number(item.slideNumber) === Number(slide.number));
        if (take) {
          await saveSlideTake(project.id, slide.number, {
            ...take,
            accepted: false,
            cleanedBlob: null,
            trimStart: 0,
            trimEnd: null,
            removedRanges: [],
            cleanedDurationMs: null,
            cleanedAt: null,
          });
        }
      }

      const nextProject = {
        ...project,
        name: Number(slide.number) === 1 ? nextSlide.title : project.name,
        slides: nextSlides,
        rawText: serializeProject(nextSlides),
        productionPlan: { ...plan, scenes, ctaAssets, memes },
        updatedAt: Date.now(),
      };
      await saveProject(nextProject);
      window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
      sessionStorage.setItem('videosstudio:edited-slide', String(slide.number));
      window.setTimeout(() => window.location.reload(), 220);
    } catch (caught) {
      console.error(caught);
      setError(caught?.message || 'No se pudo guardar la corrección.');
      setBusy(false);
    }
  }

  async function deleteCurrentSlide() {
    if (busy || isRecordingBusy()) {
      setError('Finaliza la grabación antes de eliminar una diapositiva.');
      return;
    }
    const active = project?.id ? project : await getActiveProject();
    const number = Number(slideNumber);
    const selected = active?.slides?.find((item) => Number(item.number) === number);
    if (!active?.id || !selected) return setError('No se pudo encontrar la diapositiva actual.');
    if ((active.slides || []).length <= 1) return setError('El proyecto debe conservar al menos una diapositiva.');

    const confirmed = window.confirm(
      `¿Eliminar la diapositiva ${number} “${selected.title}”?\n\nSe eliminarán su grabación, corte, imágenes y montaje. Las diapositivas posteriores se renumerarán automáticamente y sus grabaciones se conservarán.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    try {
      await assertNoRecoverableRecording(active.id);
      const [takes, preferences] = await Promise.all([
        getProjectTakes(active.id),
        getTemplatePreferences(active.id),
      ]);

      await deleteSlideTake(active.id, number);
      const laterTakes = takes
        .filter((take) => Number(take.slideNumber) > number)
        .sort((a, b) => Number(a.slideNumber) - Number(b.slideNumber));
      for (const take of laterTakes) {
        const oldNumber = Number(take.slideNumber);
        const { key: _key, projectId: _projectId, slideNumber: _slideNumber, ...data } = take;
        await saveSlideTake(active.id, oldNumber - 1, data);
        await deleteSlideTake(active.id, oldNumber);
      }

      await removeVisualSlideAndShift(active.id, number);
      await setTemplatePreferences(active.id, remapTemplatePreferences(preferences, number));

      const nextSlides = active.slides
        .filter((item) => Number(item.number) !== number)
        .map((item) => Number(item.number) > number ? { ...item, number: Number(item.number) - 1 } : item);
      const plan = active.productionPlan || {};
      const nextPlan = {
        ...plan,
        scenes: remapIndexedObject(plan.scenes, number),
        transitions: remapIndexedObject(plan.transitions, number),
        ctaAssets: remapIndexedObject(plan.ctaAssets, number),
        memes: (plan.memes || [])
          .filter((item) => Number(item.slideNumber) !== number)
          .map((item) => Number(item.slideNumber) > number ? { ...item, slideNumber: Number(item.slideNumber) - 1 } : item),
      };
      const nextNumber = Math.min(number, nextSlides.length);
      const nextProject = {
        ...active,
        name: number === 1 ? nextSlides[0]?.title || active.name : active.name,
        slides: nextSlides,
        rawText: serializeProject(nextSlides),
        productionPlan: nextPlan,
        updatedAt: Date.now(),
      };
      await saveProject(nextProject);
      window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
      sessionStorage.setItem('videosstudio:edited-slide', String(nextNumber));
      window.setTimeout(() => window.location.reload(), 220);
    } catch (caught) {
      console.error(caught);
      setError(caught?.message || 'No se pudo eliminar la diapositiva.');
      setBusy(false);
    }
  }

  const controls = target ? createPortal(
    <div className="slide-editor-inline-actions">
      <button type="button" onClick={openEditor}>Editar</button>
      <button type="button" className="slide-delete-button" onClick={deleteCurrentSlide}>Eliminar</button>
    </div>,
    target,
  ) : null;

  const modal = open && draft && slide ? createPortal(
    <div className="slide-editor-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) setOpen(false);
    }}>
      <section className="slide-editor-modal" role="dialog" aria-modal="true" aria-label={`Editar diapositiva ${slide.number}`}>
        <header>
          <div>
            <span className="eyebrow">DIAPOSITIVA {slide.number}</span>
            <h2>Corregir diapositiva</h2>
            <p>Si cambias LECTURA, la toma queda marcada para regrabar. Los demás cambios conservan la grabación.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} disabled={busy} aria-label="Cerrar">×</button>
        </header>

        <div className="slide-editor-form">
          <label className="wide"><span>Título</span><input value={draft.title} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} /></label>
          <label className="wide"><span>Gancho</span><textarea rows="2" value={draft.hook} onChange={(event) => setDraft((old) => ({ ...old, hook: event.target.value }))} /></label>
          <label className="wide reading-field"><span>Lectura</span><textarea rows="7" value={draft.reading} onChange={(event) => setDraft((old) => ({ ...old, reading: event.target.value }))} /></label>
          <label><span>Cuerpo · un punto por línea</span><textarea rows="5" value={draft.body} onChange={(event) => setDraft((old) => ({ ...old, body: event.target.value }))} /></label>
          <label><span>Contenido · un punto por línea</span><textarea rows="5" value={draft.content} onChange={(event) => setDraft((old) => ({ ...old, content: event.target.value }))} /></label>
          <label><span>Visual</span><textarea rows="4" value={draft.visual} onChange={(event) => setDraft((old) => ({ ...old, visual: event.target.value }))} /></label>
          <label><span>CTA</span><textarea rows="4" value={draft.cta} onChange={(event) => setDraft((old) => ({ ...old, cta: event.target.value }))} /></label>
        </div>

        {error && <div className="slide-editor-error">{error}</div>}
        <footer>
          <button type="button" className="slide-editor-danger" onClick={deleteCurrentSlide} disabled={busy}>Eliminar diapositiva</button>
          <div>
            <button type="button" className="secondary-button" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button>
            <button type="button" className="primary-button" onClick={saveChanges} disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  ) : null;

  const toast = error && !open ? createPortal(
    <div className="slide-editor-toast" onClick={() => setError('')}>{error}</div>,
    document.body,
  ) : null;

  return <>{controls}{modal}{toast}</>;
}
