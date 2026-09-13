import ProductionApp from './ProductionApp';
import TemplateManager from './TemplateManager';
import VisualManager from './VisualManager';
import WorkflowEnhancer from './WorkflowEnhancer';
import ProjectManager from './ProjectManager';
import ProjectBackupManager from './ProjectBackupManager';
import FinalRenderManager from './FinalRenderManager';
import SlideEditorManager from './SlideEditorManager';
import RecordingViewEnhancer from './RecordingViewEnhancer';
import CutStudioEnhancer from './CutStudioEnhancer';
import CutSaveStatusBridge from './CutSaveStatusBridge';
import IntegrityGuard from './IntegrityGuard';
import RecoverySafetyGuard from './RecoverySafetyGuard';
import UpdateEnhancer from './UpdateEnhancer';
import './branding.css';
import './safety-fixes.css';

export default function App() {
  return (
    <>
      <ProductionApp />
      <TemplateManager />
      <VisualManager />
      <WorkflowEnhancer />
      <ProjectManager />
      <ProjectBackupManager />
      <FinalRenderManager />
      <SlideEditorManager />
      <RecordingViewEnhancer />
      <CutStudioEnhancer />
      <CutSaveStatusBridge />
      <IntegrityGuard />
      <RecoverySafetyGuard />
      <UpdateEnhancer />
    </>
  );
}
