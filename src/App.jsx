import { useState } from 'react';
import ProductionApp from './ProductionApp';
import TemplateManager from './TemplateManager';
import VisualManager from './VisualManager';
import WorkflowEnhancer from './WorkflowEnhancer';
import ProjectManager from './ProjectManager';
import ProjectBackupManager from './ProjectBackupManager';
import FinalRenderManager from './FinalRenderManager';
import SlideEditorManager from './SlideEditorManager';
import VerificationManager from './VerificationManager';
import PromptVerificationGuard from './PromptVerificationGuard';
import RecordingViewEnhancer from './RecordingViewEnhancer';
import RecordingAdvanceManager from './RecordingAdvanceManager';
import CutStudioEnhancer from './CutStudioEnhancer';
import CutSaveStatusBridge from './CutSaveStatusBridge';
import IntegrityGuard from './IntegrityGuard';
import RecoverySafetyGuard from './RecoverySafetyGuard';
import UpdateEnhancer from './UpdateEnhancer';
import { getActiveProject, setActiveProject } from './storage';
import './branding.css';
import './safety-fixes.css';

const CONTENT_MODE_KEY = 'videosstudio:content-mode';
const LAUNCH_MODE_KEY = 'videosstudio:project-launch-mode';

function initialContentMode() {
  const launchMode = sessionStorage.getItem(LAUNCH_MODE_KEY);
  const savedMode = sessionStorage.getItem(CONTENT_MODE_KEY);
  if (launchMode && ['football', 'cinema'].includes(savedMode)) return savedMode;
  return '';
}

function ModeSelector({ onSelect }) {
  return (
    <main className="mode-selector">
      <section className="mode-selector-panel">
        <div className="mode-selector-copy">
          <span>VIDEOS STUDIO</span>
          <h1>¿Qué contenido vas a crear?</h1>
          <p>Elige el tipo de proyecto. El flujo de producción se mantiene igual y solo cambia la estructura del contenido.</p>
        </div>
        <div className="mode-selector-grid">
          <button className="mode-card" onClick={() => onSelect('football')}>
            <small>11 RECORDS</small>
            <strong>Fútbol</strong>
            <span>Récords, estadísticas y contenido futbolístico.</span>
          </button>
          <button className="mode-card" onClick={() => onSelect('cinema')}>
            <small>ANÁLISIS</small>
            <strong>Cine</strong>
            <span>Veredicto, cinco criterios y nota final de la película.</span>
          </button>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [contentMode, setContentMode] = useState(initialContentMode);

  async function chooseContentMode(nextMode) {
    try {
      const active = await getActiveProject();
      const activeMode = active?.contentMode || 'football';
      if (active && activeMode !== nextMode) await setActiveProject(null);
    } catch (caught) {
      console.error('No se pudo comprobar el proyecto activo al cambiar de sección.', caught);
    }
    sessionStorage.setItem(CONTENT_MODE_KEY, nextMode);
    setContentMode(nextMode);
  }

  if (!contentMode) return <ModeSelector onSelect={chooseContentMode} />;

  return (
    <>
      <ProductionApp contentMode={contentMode} onChangeContentMode={() => setContentMode('')} />
      <TemplateManager />
      <VisualManager />
      <WorkflowEnhancer />
      <ProjectManager contentMode={contentMode} />
      <ProjectBackupManager />
      <FinalRenderManager />
      <SlideEditorManager />
      <VerificationManager />
      <PromptVerificationGuard contentMode={contentMode} />
      <RecordingViewEnhancer />
      <RecordingAdvanceManager />
      <CutStudioEnhancer />
      <CutSaveStatusBridge />
      <IntegrityGuard />
      <RecoverySafetyGuard />
      <UpdateEnhancer />
    </>
  );
}
