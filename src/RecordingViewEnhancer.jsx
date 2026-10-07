export function FramingGuides() {
  return <div className="framing-guides" aria-hidden="true">
    <div className="framing-safe-top"><span>zona segura</span></div>
    <div className="framing-eye-line"><span>ojos</span></div>
    <div className="framing-center-line" />
  </div>;
}

// Preparation controls receive React state directly; no DOM observers or simulated clicks.
export default function RecordingViewEnhancer({ viewMode, guides, running, onCamera, onPractice, onGuides }) {
  return <div className="recording-view-switch" aria-label="Preparación de grabación">
    <button type="button" className={viewMode === 'camera' ? 'active' : ''} onClick={onCamera}>Vista cámara</button>
    <button type="button" className={viewMode === 'prompter' ? 'active' : ''} onClick={onPractice}>{running ? 'Pausar ensayo' : 'Prompter'}</button>
    <button type="button" className={guides ? 'active guide-toggle' : 'guide-toggle'} onClick={onGuides}>Guías</button>
  </div>;
}
