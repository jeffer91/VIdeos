import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getActiveProject, saveProject } from './storage';
import './verification.css';

function currentSlideNumber() {
  const text = document.querySelector('.recording-flow .slide-flow-header span')?.textContent || '';
  return Number(text.match(/DIAPOSITIVA\s+(\d+)/i)?.[1] || 0);
}

function signature(slide) {
  if (!slide) return '';
  return JSON.stringify([
    slide.title || '',
    slide.hook || '',
    slide.body || '',
    slide.content || '',
    slide.reading || '',
    slide.visual || '',
    slide.cta || '',
  ]);
}

function verificationIsCurrent(slide) {
  return Boolean(
    slide?.verification?.status === 'verified'
    && slide.verification.signature
    && slide.verification.signature === signature(slide),
  );
}

export default function VerificationManager() {
  const [target, setTarget] = useState(null);
  const [slideNumber, setSlideNumber] = useState(0);
  const [project, setProject] = useState(null);
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    const number = currentSlideNumber();
    setSlideNumber(number);
    const active = await getActiveProject();
    setProject(active || null);
    return active;
  }

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    const sync = () => {
      const header = document.querySelector('.recording-flow .slide-flow-header > div');
      setTarget(header || null);
      setSlideNumber(currentSlideNumber());
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    sync();
    refresh().catch(() => {});
    const onChange = () => refresh().catch(() => {});
    window.addEventListener('videosstudio:project-plan-changed', onChange);
    return () => {
      observer.disconnect();
      window.removeEventListener('videosstudio:project-plan-changed', onChange);
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    refresh().catch(() => {});
  }, [target, slideNumber]);

  const slide = useMemo(
    () => project?.slides?.find((item) => Number(item.number) === Number(slideNumber)) || null,
    [project, slideNumber],
  );
  const verified = verificationIsCurrent(slide);

  function openVerification() {
    if (!slide) return;
    setSources((slide.verification?.sources || []).join('\n'));
    setNotes(slide.verification?.notes || '');
    setError('');
    setOpen(true);
  }

  useEffect(() => {
    const guardRecord = async (event) => {
      const button = event.target?.closest?.('.recording-flow .record-button');
      if (!button) return;
      const active = await getActiveProject();
      const number = currentSlideNumber();
      const activeSlide = active?.slides?.find((item) => Number(item.number) === number);
      if (verificationIsCurrent(activeSlide)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      setProject(active || null);
      setSlideNumber(number);
      setSources((activeSlide?.verification?.sources || []).join('\n'));
      setNotes(activeSlide?.verification?.notes || '');
      setError('Verifica los datos de esta diapositiva antes de grabarla.');
      setOpen(true);
    };
    document.addEventListener('click', guardRecord, true);
    return () => document.removeEventListener('click', guardRecord, true);
  }, []);

  async function saveVerification(status) {
    if (!project?.id || !slide || busy) return;
    const cleanSources = sources.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (status === 'verified' && cleanSources.length < 1) {
      setError('Agrega al menos una fuente o referencia antes de marcar como verificada.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextSlides = project.slides.map((item) => Number(item.number) === Number(slide.number)
        ? {
            ...item,
            verification: {
              status,
              sources: cleanSources,
              notes: notes.trim(),
              signature: signature(item),
              updatedAt: Date.now(),
            },
          }
        : item);
      const nextProject = { ...project, slides: nextSlides, updatedAt: Date.now() };
      await saveProject(nextProject);
      setProject(nextProject);
      window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
      setOpen(false);
    } catch (caught) {
      setError(caught?.message || 'No se pudo guardar la verificación.');
    } finally {
      setBusy(false);
    }
  }

  const control = target ? createPortal(
    <button
      type="button"
      className={`verification-inline-button ${verified ? 'verified' : 'pending'}`}
      onClick={openVerification}
      title={verified ? 'Datos verificados para la versión actual de la diapositiva' : 'Revisar datos y fuentes antes de grabar'}
    >
      {verified ? 'Verificación ✓' : 'Verificar datos'}
    </button>,
    target,
  ) : null;

  const modal = open && slide ? createPortal(
    <div className="verification-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) setOpen(false);
    }}>
      <section className="verification-modal" role="dialog" aria-modal="true" aria-label={`Verificar diapositiva ${slide.number}`}>
        <header>
          <div>
            <span className="eyebrow">DIAPOSITIVA {slide.number}</span>
            <h2>Verificación factual</h2>
            <p>Confirma fechas, cifras, récords, cronología y comparaciones antes de grabar.</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} disabled={busy} aria-label="Cerrar">×</button>
        </header>

        <div className="verification-summary">
          <strong>{slide.title}</strong>
          <p>{slide.reading}</p>
        </div>

        <label>
          <span>Fuentes o referencias · una por línea</span>
          <textarea rows="5" value={sources} onChange={(event) => setSources(event.target.value)} placeholder="URL oficial, organismo, base estadística o medio confiable" />
        </label>
        <label>
          <span>Notas de comprobación</span>
          <textarea rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Qué comprobaste o qué dato requiere cautela" />
        </label>

        {error && <div className="verification-error">{error}</div>}
        <footer>
          <button type="button" className="secondary-button" onClick={() => saveVerification('review')} disabled={busy}>Dejar en revisión</button>
          <button type="button" className="primary-button" onClick={() => saveVerification('verified')} disabled={busy}>{busy ? 'Guardando…' : 'Marcar verificada'}</button>
        </footer>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{control}{modal}</>;
}
