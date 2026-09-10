import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  clearRecordingData,
  getActiveProject,
  getChunks,
  getRecordingMeta,
  listProjects,
  setActiveProject,
} from './storage';

const LAUNCH_MODE_KEY = 'videosstudio:project-launch-mode';

function isRecordingBusy() {
  return Boolean(document.querySelector(
    '.status-recording, .status-paused, .status-saving, .status-detecting, .rec-indicator',
  ));
}

function formatUpdated(value) {
  const timestamp = Number(value) || 0;
  if (!timestamp) return 'Sin fecha';
  try {
    return new Intl.DateTimeFormat('es-EC', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export default function ProjectManager() {
  const launchModeRef = useRef(sessionStorage.getItem(LAUNCH_MODE_KEY) || '');
  const [headerTarget, setHeaderTarget] = useState(null);
  const [activeProject, setActiveProjectState] = useState(null);
  const [projects, setProjects] = useState([]);
  const [hubOpen, setHubOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refreshProjects() {
    const [active, rows] = await Promise.all([
      getActiveProject(),
      listProjects(),
    ]);
    setActiveProjectState(active || null);
    setProjects(rows || []);
    setHydrated(true);
  }

  useEffect(() => {
    sessionStorage.removeItem(LAUNCH_MODE_KEY);
    refreshProjects().catch(() => {
      setError('No se pudo leer la lista de proyectos locales.');
      setHydrated(true);
    });

    const timer = window.setInterval(() => refreshProjects().catch(() => {}), 1800);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!hydrated || activeProject) return;
    if (launchModeRef.current === 'new') return;
    if (projects.length) setHubOpen(true);
  }, [hydrated, activeProject, projects.length]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;

    const syncTarget = () => setHeaderTarget(document.querySelector('.production-header'));
    const observer = new MutationObserver(syncTarget);
    observer.observe(root, { childList: true, subtree: true });
    syncTarget();
    return () => observer.disconnect();
  }, []);

  const orderedProjects = useMemo(
    () => [...projects].sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)),
    [projects],
  );

  function guardRecording() {
    if (!isRecordingBusy()) return true;
    setError('Finaliza o cancela la grabación actual antes de cambiar de proyecto.');
    return false;
  }

  async function confirmDiscardRecovery() {
    const meta = await getRecordingMeta();
    if (!meta?.projectId || !meta?.slideNumber) return true;
    const chunks = await getChunks();
    if (!chunks.length) return true;

    const sameActiveProject = activeProject?.id && activeProject.id === meta.projectId;
    const label = sameActiveProject
      ? `la diapositiva ${meta.slideNumber} del proyecto actual`
      : `la diapositiva ${meta.slideNumber} de otro proyecto`;
    return window.confirm(
      `Hay una grabación interrumpida recuperable de ${label}. Si cambias de proyecto ahora, esa recuperación se descartará. ¿Continuar de todos modos?`,
    );
  }

  async function changeProject({ projectId = '', mode = 'open', ask = true } = {}) {
    if (busy || !guardRecording()) return;

    const switchingAway = activeProject?.id && activeProject.id !== projectId;
    if (ask && switchingAway) {
      const message = mode === 'new'
        ? 'El proyecto actual quedará guardado. Los cambios de contenido que aún no hayas guardado se perderán. ¿Crear un nuevo proyecto?'
        : mode === 'exit'
          ? 'El proyecto actual quedará guardado. ¿Salir del proyecto y volver a la lista de proyectos?'
          : 'El proyecto actual quedará guardado. Los cambios de contenido que aún no hayas guardado se perderán. ¿Abrir otro proyecto?';
      if (!window.confirm(message)) return;
    }

    try {
      if (!(await confirmDiscardRecovery())) return;
    } catch (caught) {
      console.error(caught);
      setError('No se pudo comprobar si existe una grabación recuperable. Intenta nuevamente antes de cambiar de proyecto.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await clearRecordingData();
      await setActiveProject(projectId || null);
      if (mode === 'new') sessionStorage.setItem(LAUNCH_MODE_KEY, 'new');
      if (mode === 'exit') sessionStorage.setItem(LAUNCH_MODE_KEY, 'hub');
      window.location.reload();
    } catch (caught) {
      console.error(caught);
      setBusy(false);
      setError(caught.message || 'No se pudo cambiar de proyecto.');
    }
  }

  function openProject(project) {
    if (!project?.id) return;
    if (project.id === activeProject?.id) {
      setHubOpen(false);
      return;
    }
    changeProject({ projectId: project.id, mode: 'open' });
  }

  const controls = (
    <div className="project-command-bar">
      <button className="project-current" onClick={() => setHubOpen(true)} title="Abrir lista de proyectos">
        <span className="project-current-icon">▦</span>
        <span>
          <small>PROYECTO</small>
          <strong>{activeProject?.name || 'Sin proyecto activo'}</strong>
        </span>
      </button>
      <div className="project-command-actions">
        <button onClick={() => setHubOpen(true)} disabled={busy}>Proyectos</button>
        <button className="project-new-button" onClick={() => changeProject({ mode: 'new', ask: Boolean(activeProject) })} disabled={busy}>+ Nuevo proyecto</button>
        {activeProject && (
          <button className="project-exit-button" onClick={() => changeProject({ mode: 'exit' })} disabled={busy}>Salir del proyecto</button>
        )}
      </div>
    </div>
  );

  const modal = hubOpen ? (
    <div className="project-hub-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setHubOpen(false);
    }}>
      <section className="project-hub" role="dialog" aria-modal="true" aria-label="Proyectos de Videos Studio">
        <header>
          <div>
            <span className="project-hub-eyebrow">VIDEOS STUDIO</span>
            <h2>Proyectos</h2>
            <p>Abre un proyecto existente o empieza uno nuevo. Salir de un proyecto no elimina sus grabaciones ni su montaje.</p>
          </div>
          <button className="project-hub-close" onClick={() => setHubOpen(false)} aria-label="Cerrar">×</button>
        </header>

        {error && <div className="project-hub-error">{error}</div>}

        <div className="project-hub-toolbar">
          <span>{orderedProjects.length} proyecto{orderedProjects.length === 1 ? '' : 's'} guardado{orderedProjects.length === 1 ? '' : 's'}</span>
          <button className="project-new-button" onClick={() => changeProject({ mode: 'new', ask: Boolean(activeProject) })} disabled={busy}>+ Nuevo proyecto</button>
        </div>

        <div className="project-list">
          {orderedProjects.length ? orderedProjects.map((item) => {
            const isActive = item.id === activeProject?.id;
            return (
              <article className={`project-list-card ${isActive ? 'active' : ''}`} key={item.id}>
                <div className="project-list-mark">{isActive ? '✓' : '▶'}</div>
                <div className="project-list-copy">
                  <div className="project-list-title">
                    <strong>{item.name || 'Proyecto sin nombre'}</strong>
                    {isActive && <span>ACTUAL</span>}
                  </div>
                  <small>{item.slides?.length || 0} diapositivas · Actualizado {formatUpdated(item.updatedAt)}</small>
                </div>
                <button onClick={() => openProject(item)} disabled={busy}>{isActive ? 'Continuar' : 'Abrir'}</button>
              </article>
            );
          }) : (
            <div className="project-list-empty">
              <span>＋</span>
              <strong>Todavía no hay proyectos guardados</strong>
              <p>Crea uno nuevo y carga la estructura de tu primer video.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      {headerTarget ? createPortal(controls, headerTarget) : null}
      {modal ? createPortal(modal, document.body) : null}
      {error && !hubOpen ? (
        <div className="project-manager-toast">
          <span>{error}</span>
          <button onClick={() => setError('')}>×</button>
        </div>
      ) : null}
    </>
  );
}
