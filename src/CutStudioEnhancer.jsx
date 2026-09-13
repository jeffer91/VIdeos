import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './cut-studio.css';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteDuration(value, fallback = 0) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const safeFallback = Number(fallback);
  return Number.isFinite(safeFallback) && safeFallback > 0 ? safeFallback : 0;
}

function formatClock(seconds = 0) {
  const safe = finiteDuration(seconds, 0);
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenths}`;
}

function numberFromText(value = '') {
  const numeric = Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : 0;
}

function setNativeInputValue(input, value) {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, String(value));
  else input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function durationFromTarget(target) {
  const trimInputs = target?.querySelectorAll('.trim-controls input');
  return finiteDuration(numberFromText(trimInputs?.[1]?.value || 0), 0);
}

function readCutState(target, fallbackDuration = 0) {
  const fallback = finiteDuration(fallbackDuration, durationFromTarget(target));
  if (!target) return { start: 0, end: fallback, ranges: [] };
  const trimInputs = target.querySelectorAll('.trim-controls input');
  const start = Math.max(0, numberFromText(trimInputs[0]?.value || 0));
  const end = finiteDuration(numberFromText(trimInputs[1]?.value || 0), fallback);
  const ranges = [...target.querySelectorAll('.cut-range-list > span')]
    .map((node) => {
      const match = (node.textContent || '').match(/([\d.,]+)\s*[–-]\s*([\d.,]+)/);
      return match ? { start: numberFromText(match[1]), end: numberFromText(match[2]) } : null;
    })
    .filter(Boolean)
    .filter((range) => range.end > range.start);
  return { start, end, ranges };
}

function writeRangeInputs(target, start, end) {
  const inputs = target?.querySelectorAll('.internal-cut-inputs input');
  if (!inputs?.length) return;
  setNativeInputValue(inputs[0], Math.max(0, start).toFixed(2));
  setNativeInputValue(inputs[1], Math.max(0, end).toFixed(2));
}

function writeTrimInput(target, side, value) {
  const inputs = target?.querySelectorAll('.trim-controls input');
  const input = side === 'end' ? inputs?.[1] : inputs?.[0];
  setNativeInputValue(input, Math.max(0, value).toFixed(2));
}

function activeSlideLabel() {
  const active = document.querySelector('.cut-list button.active');
  const number = active?.querySelector(':scope > span')?.textContent?.trim() || '';
  const title = active?.querySelector('strong')?.textContent?.trim() || '';
  return { number, title };
}

function buildWaveform(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  const duration = finiteDuration(audioBuffer.duration, 0);
  const bins = 720;
  const step = Math.max(1, Math.floor(data.length / bins));
  const peaks = [];
  let max = 0;

  for (let bin = 0; bin < bins; bin += 1) {
    const start = bin * step;
    const end = Math.min(data.length, start + step);
    const sampleStride = Math.max(1, Math.floor((end - start) / 100));
    let sumSquares = 0;
    let count = 0;
    for (let index = start; index < end; index += sampleStride) {
      const sample = data[index] || 0;
      sumSquares += sample * sample;
      count += 1;
    }
    const rms = count ? Math.sqrt(sumSquares / count) : 0;
    peaks.push(rms);
    max = Math.max(max, rms);
  }

  const normalized = peaks.map((value) => max > 0 ? value / max : 0);
  const binDuration = duration > 0 ? duration / bins : 0;
  const silences = [];
  let silenceStart = null;

  normalized.forEach((value, index) => {
    const quiet = value < 0.075;
    if (quiet && silenceStart === null) silenceStart = index * binDuration;
    if ((!quiet || index === normalized.length - 1) && silenceStart !== null) {
      const silenceEnd = (quiet ? index + 1 : index) * binDuration;
      if (silenceEnd - silenceStart >= 0.55) silences.push({ start: silenceStart, end: silenceEnd });
      silenceStart = null;
    }
  });

  return { peaks: normalized, silences, duration };
}

function estimatedOutputDuration(state, duration) {
  const end = finiteDuration(state.end, duration);
  const start = Math.max(0, Number(state.start) || 0);
  const removed = (state.ranges || []).reduce((sum, range) => {
    const low = clamp(Number(range.start) || 0, start, end);
    const high = clamp(Number(range.end) || 0, start, end);
    return sum + Math.max(0, high - low);
  }, 0);
  return Math.max(0, end - start - removed);
}

export default function CutStudioEnhancer() {
  const [target, setTarget] = useState(null);
  const [media, setMedia] = useState(null);
  const [src, setSrc] = useState('');
  const [playing, setPlaying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState([]);
  const [silences, setSilences] = useState([]);
  const [waveStatus, setWaveStatus] = useState('idle');
  const [selection, setSelection] = useState(null);
  const [timeline, setTimeline] = useState({ start: 0, end: 0, ranges: [] });
  const [resizeTick, setResizeTick] = useState(0);
  const canvasRef = useRef(null);
  const dragStartRef = useRef(null);
  const previewRef = useRef(false);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;

    const sync = () => {
      const nextTarget = document.querySelector('.cut-flow .cut-editor');
      const nextMedia = nextTarget?.querySelector('.cut-video video, .cut-video audio') || null;
      setTarget(nextTarget || null);
      setMedia(nextMedia);
      const nextSrc = nextMedia?.currentSrc || nextMedia?.getAttribute('src') || '';
      setSrc(nextSrc);
      if (nextMedia) nextMedia.controls = false;
    };

    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class'] });
    sync();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!media) {
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return undefined;
    }

    media.controls = false;
    const getDuration = () => finiteDuration(media.duration, durationFromTarget(target));
    const syncTime = () => {
      setCurrentTime(Number.isFinite(media.currentTime) ? media.currentTime : 0);
      const nextDuration = getDuration();
      if (nextDuration > 0) setDuration(nextDuration);

      if (previewRef.current) {
        const state = readCutState(target, nextDuration);
        const current = Number.isFinite(media.currentTime) ? media.currentTime : 0;
        const removed = state.ranges.find((range) => current >= range.start && current < range.end - 0.01);
        if (removed) {
          media.currentTime = Math.min(state.end || nextDuration, removed.end + 0.01);
          return;
        }
        if (state.end > 0 && current >= state.end - 0.015) {
          media.pause();
          previewRef.current = false;
          setPreviewing(false);
        }
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onLoaded = () => {
      const nextDuration = getDuration();
      if (nextDuration > 0) setDuration(nextDuration);
      setCurrentTime(Number.isFinite(media.currentTime) ? media.currentTime : 0);
    };

    media.addEventListener('timeupdate', syncTime);
    media.addEventListener('loadedmetadata', onLoaded);
    media.addEventListener('durationchange', onLoaded);
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    media.addEventListener('ended', onPause);
    onLoaded();

    return () => {
      media.removeEventListener('timeupdate', syncTime);
      media.removeEventListener('loadedmetadata', onLoaded);
      media.removeEventListener('durationchange', onLoaded);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('ended', onPause);
    };
  }, [media, target]);

  useEffect(() => {
    if (!target) return undefined;
    const syncTimeline = () => {
      const fallback = finiteDuration(duration, durationFromTarget(target));
      setTimeline(readCutState(target, fallback));
      if (!duration && fallback > 0) setDuration(fallback);
    };
    const timer = window.setInterval(syncTimeline, 180);
    syncTimeline();
    return () => window.clearInterval(timer);
  }, [target, duration]);

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setPeaks([]);
      setSilences([]);
      setWaveStatus('idle');
      return undefined;
    }

    const load = async () => {
      setWaveStatus('loading');
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error('No se pudo leer el audio.');
        const buffer = await response.arrayBuffer();
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('El analizador de audio no está disponible.');
        const context = new AudioContextClass();
        try {
          const decoded = await context.decodeAudioData(buffer.slice(0));
          if (cancelled) return;
          const result = buildWaveform(decoded);
          setPeaks(result.peaks);
          setSilences(result.silences);
          if (result.duration > 0) setDuration(result.duration);
          setWaveStatus('ready');
        } finally {
          context.close().catch(() => {});
        }
      } catch (caught) {
        console.warn('Waveform:', caught);
        if (!cancelled) {
          setPeaks([]);
          setSilences([]);
          setWaveStatus('error');
          const fallback = durationFromTarget(target);
          if (fallback > 0) setDuration(fallback);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [src, target]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => setResizeTick((value) => value + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [target]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const safeDuration = finiteDuration(duration, durationFromTarget(target));
    if (!canvas || !safeDuration) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);

    const width = rect.width;
    const height = rect.height;
    const middle = height / 2;
    const xFor = (time) => clamp(time / safeDuration, 0, 1) * width;

    context.strokeStyle = '#d9e2ec';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, middle);
    context.lineTo(width, middle);
    context.stroke();

    silences.forEach((range) => {
      context.fillStyle = 'rgba(245, 158, 11, .09)';
      context.fillRect(xFor(range.start), 0, Math.max(1, xFor(range.end) - xFor(range.start)), height);
    });

    if (peaks.length) {
      const barWidth = width / peaks.length;
      context.fillStyle = '#637b96';
      peaks.forEach((peak, index) => {
        const barHeight = Math.max(1, peak * (height * .82));
        context.fillRect(index * barWidth, middle - barHeight / 2, Math.max(1, barWidth * .62), barHeight);
      });
    } else {
      context.fillStyle = '#94a3b8';
      context.font = '11px system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText(waveStatus === 'loading' ? 'Analizando audio…' : 'Edición disponible sin onda.', width / 2, middle + 4);
    }

    if (timeline.start > 0) {
      context.fillStyle = 'rgba(100, 116, 139, .18)';
      context.fillRect(0, 0, xFor(timeline.start), height);
    }
    if (timeline.end > 0 && timeline.end < safeDuration) {
      context.fillStyle = 'rgba(100, 116, 139, .18)';
      context.fillRect(xFor(timeline.end), 0, width - xFor(timeline.end), height);
    }

    timeline.ranges.forEach((range) => {
      context.fillStyle = 'rgba(220, 38, 38, .20)';
      context.fillRect(xFor(range.start), 0, Math.max(2, xFor(range.end) - xFor(range.start)), height);
    });

    if (selection && Math.abs(selection.end - selection.start) > 0.01) {
      const start = Math.min(selection.start, selection.end);
      const end = Math.max(selection.start, selection.end);
      context.fillStyle = 'rgba(37, 99, 235, .20)';
      context.fillRect(xFor(start), 0, Math.max(2, xFor(end) - xFor(start)), height);
      context.strokeStyle = '#2563eb';
      context.lineWidth = 1;
      context.strokeRect(xFor(start), .5, Math.max(2, xFor(end) - xFor(start)), height - 1);
    }

    context.strokeStyle = '#2563eb';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(xFor(currentTime), 0);
    context.lineTo(xFor(currentTime), height);
    context.stroke();
  }, [peaks, silences, currentTime, duration, timeline, selection, waveStatus, resizeTick, target]);

  useEffect(() => {
    if (!target) return undefined;
    const onKeyDown = (event) => {
      if (event.code !== 'Space') return;
      const tag = event.target?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag) || event.target?.isContentEditable) return;
      event.preventDefault();
      if (!media) return;
      if (media.paused) media.play().catch(() => {});
      else media.pause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [target, media]);

  const label = useMemo(() => activeSlideLabel(), [target, src]);
  const safeDuration = finiteDuration(duration, durationFromTarget(target));
  const outputDuration = estimatedOutputDuration(timeline, safeDuration);

  function seek(next) {
    if (!media || !safeDuration) return;
    media.currentTime = clamp(next, 0, safeDuration);
    setCurrentTime(media.currentTime);
  }

  function togglePlay() {
    if (!media) return;
    previewRef.current = false;
    setPreviewing(false);
    if (media.paused) media.play().catch(() => {});
    else media.pause();
  }

  function previewCuts() {
    if (!media || !safeDuration) return;
    if (previewRef.current) {
      media.pause();
      previewRef.current = false;
      setPreviewing(false);
      return;
    }
    const state = readCutState(target, safeDuration);
    media.currentTime = clamp(state.start, 0, safeDuration);
    previewRef.current = true;
    setPreviewing(true);
    media.play().catch(() => {
      previewRef.current = false;
      setPreviewing(false);
    });
  }

  function timeAtPointer(event) {
    const canvas = canvasRef.current;
    if (!canvas || !safeDuration) return 0;
    const rect = canvas.getBoundingClientRect();
    return clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * safeDuration, 0, safeDuration);
  }

  function onPointerDown(event) {
    if (!safeDuration) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const time = timeAtPointer(event);
    dragStartRef.current = time;
    setSelection({ start: time, end: time });
    seek(time);
  }

  function onPointerMove(event) {
    if (dragStartRef.current === null) return;
    setSelection({ start: dragStartRef.current, end: timeAtPointer(event) });
  }

  function finishPointer(event) {
    if (dragStartRef.current === null) return;
    const end = timeAtPointer(event);
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (high - low >= 0.03) {
      const trim = readCutState(target, safeDuration);
      const safeStart = clamp(low, trim.start, trim.end || safeDuration);
      const safeEnd = clamp(high, trim.start, trim.end || safeDuration);
      setSelection({ start: safeStart, end: safeEnd });
      writeRangeInputs(target, safeStart, safeEnd);
    } else {
      setSelection(null);
      seek(end);
    }
  }

  function markStart() {
    const state = readCutState(target, safeDuration);
    const value = clamp(currentTime, 0, Math.max(0, (state.end || safeDuration) - 0.05));
    writeTrimInput(target, 'start', value);
    setTimeline(readCutState(target, safeDuration));
  }

  function markEnd() {
    const state = readCutState(target, safeDuration);
    const value = clamp(currentTime, Math.min(safeDuration, state.start + 0.05), safeDuration);
    writeTrimInput(target, 'end', value);
    setTimeline(readCutState(target, safeDuration));
  }

  function deleteSelection() {
    if (!selection) return;
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    if (end - start < 0.03) return;
    writeRangeInputs(target, start, end);
    window.requestAnimationFrame(() => {
      target?.querySelector('.internal-cut-inputs button')?.click();
      setSelection(null);
    });
  }

  function undoLastCut() {
    const buttons = [...(target?.querySelectorAll('.cut-range-list > span button') || [])];
    buttons.at(-1)?.click();
  }

  function restoreOriginal() {
    if (!target || !safeDuration) return;
    writeTrimInput(target, 'start', 0);
    writeTrimInput(target, 'end', safeDuration);
    setSelection(null);
    const buttons = [...target.querySelectorAll('.cut-range-list > span button')];
    for (let index = buttons.length - 1; index >= 0; index -= 1) buttons[index].click();
    seek(0);
  }

  function chooseSilence(range) {
    const state = readCutState(target, safeDuration);
    const start = clamp(range.start, state.start, state.end || safeDuration);
    const end = clamp(range.end, state.start, state.end || safeDuration);
    if (end - start < 0.03) return;
    setSelection({ start, end });
    writeRangeInputs(target, start, end);
    seek(start);
  }

  function saveAndNext() {
    target?.querySelector(':scope > .primary-button')?.click();
  }

  if (!target || !media) return null;

  return createPortal(
    <section className="cut-studio-enhancer" aria-label="Controles de edición">
      <div className="cut-transport">
        <div className="cut-scene-name">
          <span>ESCENA {label.number || '—'}</span>
          <strong>{label.title || 'Grabación'}</strong>
        </div>
        <div className="cut-transport-buttons">
          <button type="button" onClick={() => seek(currentTime - 5)} title="Retroceder 5 segundos">−5s</button>
          <button type="button" onClick={() => seek(currentTime - .1)} title="Retroceder una décima">‹</button>
          <button type="button" className="cut-play-button" onClick={togglePlay}>{playing && !previewing ? '❚❚ Pausa' : '▶ Play'}</button>
          <button type="button" onClick={() => seek(currentTime + .1)} title="Avanzar una décima">›</button>
          <button type="button" onClick={() => seek(currentTime + 5)} title="Avanzar 5 segundos">+5s</button>
        </div>
        <div className="cut-time-readout"><strong>{formatClock(currentTime)}</strong><span>/ {formatClock(safeDuration)}</span></div>
      </div>

      <div className="waveform-shell">
        <canvas
          ref={canvasRef}
          className="cut-waveform"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={() => { dragStartRef.current = null; }}
        />
        <div className="waveform-legend">
          <span><i className="legend-selection" /> selección</span>
          <span><i className="legend-cut" /> eliminado</span>
          <span><i className="legend-silence" /> silencio</span>
          <small>Clic = ir · arrastrar = seleccionar</small>
        </div>
      </div>

      <div className="cut-quick-actions">
        <button type="button" onClick={markStart}>Marcar inicio</button>
        <button type="button" onClick={markEnd}>Marcar final</button>
        <button type="button" onClick={deleteSelection} disabled={!selection}>Eliminar selección</button>
        <button type="button" onClick={undoLastCut} disabled={!timeline.ranges.length}>Deshacer</button>
        <button type="button" onClick={restoreOriginal}>Restaurar</button>
        <button type="button" className={previewing ? 'active' : ''} onClick={previewCuts}>{previewing ? 'Detener preview' : 'Previsualizar'}</button>
      </div>

      {silences.length > 0 && (
        <div className="silence-suggestions">
          <span>Silencios:</span>
          <div>
            {silences.slice(0, 7).map((range, index) => (
              <button type="button" key={`${range.start}-${index}`} onClick={() => chooseSilence(range)}>
                {formatClock(range.start)}–{formatClock(range.end)}
              </button>
            ))}
            {silences.length > 7 && <small>+{silences.length - 7}</small>}
          </div>
        </div>
      )}

      <div className="cut-enhancer-footer">
        <small>IN {formatClock(timeline.start)} · OUT {formatClock(timeline.end || safeDuration)} · SALIDA ≈ {formatClock(outputDuration)} · Espacio = Play/Pausa</small>
        <button type="button" className="primary-button" onClick={saveAndNext}>Guardar y siguiente →</button>
      </div>
    </section>,
    target,
  );
}
