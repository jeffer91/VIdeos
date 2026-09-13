import ProductionApp from './ProductionApp';
import TemplateManager from './TemplateManager';
import VisualManager from './VisualManager';
import WorkflowEnhancer from './WorkflowEnhancer';
import ProjectManager from './ProjectManager';
import ProjectBackupManager from './ProjectBackupManager';
import FinalRenderManager from './FinalRenderManager';
import IntegrityGuard from './IntegrityGuard';
import UpdateEnhancer from './UpdateEnhancer';
import './branding.css';

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
      <IntegrityGuard />
      <UpdateEnhancer />
    </>
  );
}
