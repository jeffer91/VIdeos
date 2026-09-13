import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './recording-layout.css';

function recordingState(flow) {
  if (!flow) return 'idle';
  if (flow.querySelector('.status-recording')) return 'recording';
  if (flow.querySelector('.status-paused')) return 'paused';
  if (flow.querySelector('.status-stopped')) return 'stopped';
  if (flow.querySelector('.status-saving')) return 'saving';
  if (flow.querySelector('.status-detecting')) return 'detecting';
  if (flow.querySelector('.status-ready')) return 'ready';
  return 'idle';
}

function prompterToggle(flow) {
  return flow?.querySelector('.prompter-actions .primary-button') || null;
}

export default function RecordingViewEnhancer() {
  const [flow, setFlow] = useState(null);
  const [headerTarget, setHeaderTarget] = useState(null);
  const [stageTarget, setStageTarget] = useState(null);
  const [viewMode, setViewMode] = useState('camera');
  const [guides, setGuides] = useState(true);
  const [status, setStatus] = useState('idle');
  const [practiceRunning, setPracticeRunning] = useState(false);
  const lastSlideRef = useRef('');
  const manualModeRef = useRef('camera');

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;

    const sync = () => {
      const nextFlow = document.querySelector('.recording-flow');
      setFlow(nextFlow || null);
      setHeaderTarget(nextFlow?.querySelector('.slide-flow-header > div') || null);
      setStageTarget(nextFlow?.querySelector('.production-stage') || null);

      if (!nextFlow) return;
      const nextStatus = recordingState(nextFlow);
      setStatus(nextStatus);
      const toggle = prompterToggle(nextFlow);
      setPracticeRunning(Boolean(toggle && /pausar/i.test(toggle.textContent || '')));

      const slideLabel = nextFlow.querySelector('.slide-flow-header span')?.textContent || '';
      if (slideLabel && slideLabel !== lastSlideRef.current && !['recording', 'paused', 'saving'].includes(nextStatus)) {
        lastSlideRef.current = slideLabel;
        manualModeRef.current = 'camera';
        setViewMode('camera');
      }

      if (['recording', 'paused', 'saving'].includes(nextStatus)) {
        setViewMode('prompter');
      } else if (nextStatus === 'stopped') {
        setViewMode('camera');
      } else {
        setViewMode(manualModeRef.current);
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    sync();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!flow) return;
    flow.dataset.recordingView = viewMode;
    flow.dataset.framingGuides = guides ? 'on' : 'off';
  }, [flow, viewMode, guides]);

  function showCamera() {
    if (!flow || ['recording', 'paused', 'saving'].includes(status)) return;
    const toggle = prompterToggle(flow);
    if (toggle && /pausar/i.test(toggle.textContent || '')) toggle.click();
    manualModeRef.current = 'camera';
    setViewMode('camera');
  }

  function togglePractice() {
    if (!flow || ['recording', 'paused', 'saving'].includes(status)) return;
    manualModeRef.current = 'prompter';
    setViewMode('prompter');
    window.requestAnimationFrame(() => {
      const toggle = prompterToggle(flow);
      if (toggle) toggle.click();
    });
  }

  const controls = headerTarget ? createPortal(
    <div className="recording-view-switch" aria-label="Vista de grabación">
      <button
        type="button"
        className={viewMode === 'camera' ? 'active' : ''}
        onClick={showCamera}
        disabled={['recording', 'paused', 'saving'].includes(status)}
      >
        Vista cámara
      </button>
      <button
        type="button"
        className={viewMode === 'prompter' ? 'active' : ''}
        onClick={togglePractice}
        disabled={['recording', 'paused', 'saving'].includes(status)}
      >
        {practiceRunning ? 'Pausar ensayo' : 'Ensayar prompter'}
      </button>
      <button
        type="button"
        className={guides ? 'active guide-toggle' : 'guide-toggle'}
        onClick={() => setGuides((value) => !value)}
        disabled={['recording', 'paused', 'saving'].includes(status)}
      >
        Guías
      </button>
    </div>,
    headerTarget,
  ) : null;

  const guideOverlay = stageTarget && guides && viewMode === 'camera' && !['recording', 'paused', 'saving', 'stopped'].includes(status)
    ? createPortal(
      <div className="framing-guides" aria-hidden="true">
        <div className="framing-safe-top"><span>zona segura</span></div>
        <div className="framing-eye-line"><span>ojos</span></div>
        <div className="framing-center-line" />
      </div>,
      stageTarget,
    )
    : null;

  return <>{controls}{guideOverlay}</>;
}
