import ProductionApp from './ProductionApp';
import TemplateManager from './TemplateManager';
import VisualManager from './VisualManager';
import WorkflowEnhancer from './WorkflowEnhancer';
import ProjectManager from './ProjectManager';
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
      <IntegrityGuard />
      <UpdateEnhancer />
    </>
  );
}
