import ProductionApp from './ProductionApp';
import TemplateManager from './TemplateManager';
import VisualManager from './VisualManager';
import WorkflowEnhancer from './WorkflowEnhancer';
import ProjectManager from './ProjectManager';
import ClipboardEnhancer from './ClipboardEnhancer';
import IntegrityGuard from './IntegrityGuard';

export default function App() {
  return (
    <>
      <ProductionApp />
      <TemplateManager />
      <VisualManager />
      <WorkflowEnhancer />
      <ProjectManager />
      <ClipboardEnhancer />
      <IntegrityGuard />
    </>
  );
}
