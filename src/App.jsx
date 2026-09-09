import { useEffect, useMemo, useRef, useState } from 'react';
import { optimizeMedia } from './ffmpeg';
import {
  clearRecordingData,
  getChunks,
  getRecordingMeta,
  saveChunk,
  setRecordingMeta,
} from './storage';

const VIDEO_MIME_TYPES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
];

const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

function chooseMimeType(mode) {
  const candidates = mode === 'video' ? VIDEO_MIME_TYPES : AUDIO_MIME_TYPES;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : value >= 100 ? 0 : 1)} ${units[index]}`;
}

function formatTime(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function useBlobUrl(blob) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }

    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [blob]);

  return url;
}

function makeSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function extensionFor(blob, mode) {
  if (mode === 'audio') return blob?.type?.includes('mp4') ? 'm4a' : 'webm';
  return blob?.type?.includes('mp4') ? 'mp4' : 'webm';
}

function downloadBlob(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestampFilename(prefix, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}.${extension}`;
}

export default function App() {
  const [mode, setMode] = useState('video');
  const [status, setStatus] = useState('idle');
  const [devices, setDevices] = useState({ cameras: [], microphones: [] });
  const [cameraId, setCameraId] = useState('');
  const [microphoneId, setMicrophoneId] = useState('');
  const [resolution, setResolution] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [optimizedBlob, setOptimizedBlob] = useState(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recoveryMeta, setRecoveryMeta] = useState(null);

  const liveVideoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const pendingWritesRef = useRef([]);
  const chunkIndexRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const pausedStartedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const audioContextRef = useRef(null);
  const meterFrameRef = useRef(null);

  const recordingUrl = useBlobUrl(recordingBlob);
  const optimizedUrl = useBlobUrl(optimizedBlob);

  const busy = ['recording', 'paused', 'saving'].includes(status) || isOptimizing;
  const isFullHd = resolution?.width >= 1920 && resolution?.height >= 1080;

  const statusText = useMemo(() => {
    if (isOptimizing) return 'Optimizando';
    const labels = {
      idle: 'Sin activar',
      ready: 'Listo',
      recording: 'Grabando',
      paused: 'Pausado',
      saving: 'Guardando',
      stopped: 'Grabación lista',
    };
    return labels[status] || 'Listo';
  }, [isOptimizing, status]);

  function cleanupAudioMeter() {
    if (meterFrameRef.current) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setMicLevel(0);
  }

  function setupAudioMeter(stream) {
    cleanupAudioMeter();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !stream.getAudioTracks().length) return;

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    audioContextRef.current = context;

    const draw = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      setMicLevel(Math.min(100, Math.round(rms * 260)));
      meterFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
  }

  function stopMediaStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
    }
    cleanupAudioMeter();
  }

  async function refreshDevices(stream) {
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices({
      cameras: list.filter((device) => device.kind === 'videoinput'),
      microphones: list.filter((device) => device.kind === 'audioinput'),
    });

    const videoDevice = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    const audioDevice = stream.getAudioTracks()[0]?.getSettings?.().deviceId;
    if (!cameraId && videoDevice) setCameraId(videoDevice);
    if (!microphoneId && audioDevice) setMicrophoneId(audioDevice);
  }

  async function openStream(overrides = {}) {
    setError('');
    setNotice('');

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Este navegador no permite grabación con cámara y micrófono. Usa Chrome o Edge de escritorio.');
      return null;
    }

    stopMediaStream();

    const targetMode = overrides.mode || mode;
    const targetCameraId = overrides.cameraId ?? cameraId;
    const targetMicrophoneId = overrides.microphoneId ?? microphoneId;

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
      ...(targetMicrophoneId ? { deviceId: { exact: targetMicrophoneId } } : {}),
    };

    const videoConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 30, max: 30 },
      ...(targetCameraId ? { deviceId: { exact: targetCameraId } } : {}),
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: targetMode === 'video' ? videoConstraints : false,
      });

      streamRef.current = stream;
      setupAudioMeter(stream);

      if (targetMode === 'video') {
        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack?.getSettings?.() || {};
        setResolution({
          width: settings.width || 0,
          height: settings.height || 0,
          frameRate: settings.frameRate || 0,
        });

        requestAnimationFrame(() => {
          if (liveVideoRef.current) {
            liveVideoRef.current.srcObject = stream;
            liveVideoRef.current.play().catch(() => {});
          }
        });
      } else {
        setResolution(null);
      }

      await refreshDevices(stream);
      setStatus('ready');
      return stream;
    } catch (caught) {
      console.error(caught);
      const message =
        caught?.name === 'NotAllowedError'
          ? 'Debes permitir acceso a la cámara y al micrófono para grabar.'
          : caught?.name === 'OverconstrainedError'
            ? 'El dispositivo seleccionado no está disponible con esa configuración. Prueba otro dispositivo.'
            : 'No se pudo abrir la cámara o el micrófono. Revisa que ninguna otra aplicación los esté bloqueando.';
      setError(message);
      setStatus('idle');
      return null;
    }
  }

  function updateElapsed() {
    if (!recordingStartedAtRef.current) return;
    const now = Date.now();
    const currentPause = pausedStartedAtRef.current ? now - pausedStartedAtRef.current : 0;
    setElapsedMs(now - recordingStartedAtRef.current - pausedTotalRef.current - currentPause);
  }

  useEffect(() => {
    let interval;
    if (status === 'recording' || status === 'paused') {
      updateElapsed();
      interval = window.setInterval(updateElapsed, 200);
    }
    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const meta = await getRecordingMeta();
        if (!meta) return;
        const chunks = await getChunks();
        if (active && chunks.length) setRecoveryMeta(meta);
      } catch (caught) {
        console.warn('No se pudo comprobar la recuperación local.', caught);
      }
    })();

    return () => {
      active = false;
      stopMediaStream();
    };
  }, []);

  async function startRecording() {
    setError('');
    setNotice('');
    setOptimizedBlob(null);
    setOptimizationProgress(0);

    let stream = streamRef.current;
    if (!stream) stream = await openStream();
    if (!stream) return;

    try {
      await navigator.storage?.persist?.();
    } catch {
      // Persistence is optional; recording still works in IndexedDB.
    }

    try {
      await clearRecordingData();
      setRecoveryMeta(null);
      pendingWritesRef.current = [];
      chunkIndexRef.current = 0;
      setRecordingBlob(null);

      const mimeType = chooseMimeType(mode);
      const options = mimeType ? { mimeType } : {};
      if (mode === 'video') {
        options.videoBitsPerSecond = 8_000_000;
        options.audioBitsPerSecond = 128_000;
      } else {
        options.audioBitsPerSecond = 128_000;
      }

      const recorder = new MediaRecorder(stream, options);
      const sessionId = makeSessionId();
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        const index = chunkIndexRef.current++;
        const write = saveChunk({ blob: event.data, index, sessionId });
        pendingWritesRef.current.push(write);
      };

      recorder.onerror = (event) => {
        console.error(event.error || event);
        setError('La grabación encontró un error. Detén la sesión y recupera lo que se haya guardado localmente.');
      };

      recorder.onstop = async () => {
        try {
          const writeResults = await Promise.allSettled(pendingWritesRef.current);
          const failedWrite = writeResults.some((result) => result.status === 'rejected');
          if (failedWrite) {
            throw new Error('No se pudieron guardar todos los fragmentos de la grabación.');
          }

          const rows = await getChunks();
          if (!rows.length) throw new Error('La grabación no produjo datos.');

          const blob = new Blob(
            rows.map((row) => row.blob),
            { type: recorder.mimeType || mimeType || rows[0].blob.type },
          );

          setRecordingBlob(blob);
          const trackSettings = stream.getVideoTracks()[0]?.getSettings?.() || {};
          const meta = {
            sessionId,
            status: 'stopped',
            mode,
            mimeType: blob.type,
            width: trackSettings.width || 0,
            height: trackSettings.height || 0,
            frameRate: trackSettings.frameRate || 0,
            durationMs: elapsedMs,
            createdAt: Date.now(),
          };
          await setRecordingMeta(meta);
          setRecoveryMeta(meta);
          setStatus('stopped');
          setNotice('Grabación guardada localmente. Ya puedes reproducirla, optimizarla o descargarla.');
        } catch (caught) {
          console.error(caught);
          setError(caught.message || 'No se pudo preparar la grabación final.');
          setStatus('idle');
        } finally {
          stopMediaStream();
          recorderRef.current = null;
        }
      };

      recordingStartedAtRef.current = Date.now();
      pausedStartedAtRef.current = 0;
      pausedTotalRef.current = 0;
      setElapsedMs(0);

      const trackSettings = stream.getVideoTracks()[0]?.getSettings?.() || {};
      await setRecordingMeta({
        sessionId,
        status: 'recording',
        mode,
        mimeType: recorder.mimeType || mimeType,
        width: trackSettings.width || 0,
        height: trackSettings.height || 0,
        frameRate: trackSettings.frameRate || 0,
        createdAt: Date.now(),
      });

      recorder.start(1000);
      setStatus('recording');
    } catch (caught) {
      console.error(caught);
      setError('No se pudo iniciar la grabación. Revisa los permisos y el espacio libre del navegador.');
    }
  }

  function pauseRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    pausedStartedAtRef.current = Date.now();
    setStatus('paused');
  }

  function resumeRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    pausedTotalRef.current += Date.now() - pausedStartedAtRef.current;
    pausedStartedAtRef.current = 0;
    setStatus('recording');
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    updateElapsed();
    recorder.stop();
    setStatus('saving');
  }

  async function recoverRecording() {
    setError('');
    try {
      const meta = (await getRecordingMeta()) || recoveryMeta;
      const rows = await getChunks();
      if (!meta || !rows.length) {
        setRecoveryMeta(null);
        throw new Error('No hay una grabación recuperable.');
      }

      stopMediaStream();
      const recovered = new Blob(
        rows.map((row) => row.blob),
        { type: meta.mimeType || rows[0].blob.type },
      );
      setMode(meta.mode || 'video');
      setRecordingBlob(recovered);
      setOptimizedBlob(null);
      setElapsedMs(meta.durationMs || 0);
      if (meta.mode === 'video' && meta.width && meta.height) {
        setResolution({
          width: meta.width,
          height: meta.height,
          frameRate: meta.frameRate || 0,
        });
      }
      setStatus('stopped');
      setNotice(
        meta.status === 'recording'
          ? 'Se recuperaron los fragmentos guardados antes de que la sesión se interrumpiera.'
          : 'Se recuperó la última grabación local.',
      );
    } catch (caught) {
      setError(caught.message || 'No se pudo recuperar la grabación.');
    }
  }

  async function optimizeRecording() {
    if (!recordingBlob || isOptimizing) return;
    setError('');
    setNotice('');
    setIsOptimizing(true);
    setOptimizationProgress(0);

    try {
      const result = await optimizeMedia(recordingBlob, mode, setOptimizationProgress);
      setOptimizedBlob(result);
      setNotice(
        result.size < recordingBlob.size
          ? 'Optimización completada manteniendo Full HD en video.'
          : 'Optimización completada. En este archivo el resultado no fue más pequeño que el original.',
      );
    } catch (caught) {
      console.error(caught);
      setError(
        'No se pudo optimizar este archivo. El original sigue intacto y puedes descargarlo. En videos muy largos, FFmpeg puede quedarse sin memoria del navegador.',
      );
    } finally {
      setIsOptimizing(false);
    }
  }

  async function newRecording() {
    stopMediaStream();
    setRecordingBlob(null);
    setOptimizedBlob(null);
    setOptimizationProgress(0);
    setElapsedMs(0);
    setResolution(null);
    setNotice('');
    setError('');
    setStatus('idle');
    setRecoveryMeta(null);
    await clearRecordingData().catch(() => {});
  }

  async function applyDevices() {
    if (busy) return;
    await openStream({ cameraId, microphoneId });
  }

  function changeMode(nextMode) {
    if (busy || nextMode === mode) return;
    stopMediaStream();
    setMode(nextMode);
    setStatus('idle');
    setResolution(null);
    setRecordingBlob(null);
    setOptimizedBlob(null);
    setElapsedMs(0);
    setError('');
    setNotice('');
  }

  const originalExtension = recordingBlob ? extensionFor(recordingBlob, mode) : 'webm';
  const optimizedExtension = mode === 'video' ? 'mp4' : 'm4a';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">Videos</div>
          <p className="subtitle">Grabación local · sin nube · sin servidor</p>
        </div>
        <div className={`status-pill status-${status}${isOptimizing ? ' status-optimizing' : ''}`}>
          <span className="status-dot" />
          {statusText}
        </div>
      </header>

      <main className="workspace">
        <section className="recorder-panel">
          <div className="panel-toolbar">
            <div className="mode-switch" role="group" aria-label="Modo de grabación">
              <button
                className={mode === 'video' ? 'active' : ''}
                onClick={() => changeMode('video')}
                disabled={busy}
              >
                Video + audio
              </button>
              <button
                className={mode === 'audio' ? 'active' : ''}
                onClick={() => changeMode('audio')}
                disabled={busy}
              >
                Solo audio
              </button>
            </div>

            <div className="quality-badges">
              {mode === 'video' && <span>16:9</span>}
              {mode === 'video' && <span>1080p objetivo</span>}
              <span>30 fps</span>
            </div>
          </div>

          <div className={`media-stage ${mode === 'audio' ? 'audio-stage' : ''}`}>
            {mode === 'video' ? (
              recordingUrl && status === 'stopped' ? (
                <video className="playback" src={recordingUrl} controls playsInline />
              ) : (
                <video className="live-video" ref={liveVideoRef} muted playsInline />
              )
            ) : recordingUrl && status === 'stopped' ? (
              <div className="audio-playback-card">
                <div className="audio-icon">AUDIO</div>
                <audio src={recordingUrl} controls />
              </div>
            ) : (
              <div className="audio-live-card">
                <div className="audio-icon">MIC</div>
                <h2>{status === 'idle' ? 'Activa el micrófono' : 'Micrófono preparado'}</h2>
                <p>Grabación de voz local a 48 kHz cuando el dispositivo lo permite.</p>
              </div>
            )}

            {mode === 'video' && !recordingUrl && status === 'idle' && (
              <div className="stage-placeholder">
                <strong>Cámara apagada</strong>
                <span>Actívala para comprobar encuadre, resolución y micrófono.</span>
              </div>
            )}

            {(status === 'recording' || status === 'paused') && (
              <div className="recording-overlay">
                <span className="rec-dot" />
                {status === 'paused' ? 'PAUSA' : 'REC'}
              </div>
            )}
          </div>

          <div className="meter-row">
            <span>MIC</span>
            <div className="meter-track">
              <div className="meter-fill" style={{ width: `${Math.max(2, micLevel)}%` }} />
            </div>
            <strong>{micLevel}%</strong>
          </div>

          <div className="timer">{formatTime(elapsedMs)}</div>

          <div className="primary-controls">
            {status === 'idle' && (
              <button className="button button-secondary" onClick={() => openStream()}>
                Activar {mode === 'video' ? 'cámara y micrófono' : 'micrófono'}
              </button>
            )}

            {status === 'ready' && (
              <button className="button button-record" onClick={startRecording}>
                <span className="button-rec-dot" />
                Grabar
              </button>
            )}

            {status === 'recording' && (
              <>
                <button className="button button-secondary" onClick={pauseRecording}>
                  Pausar
                </button>
                <button className="button button-stop" onClick={stopRecording}>
                  Finalizar
                </button>
              </>
            )}

            {status === 'paused' && (
              <>
                <button className="button button-primary" onClick={resumeRecording}>
                  Continuar
                </button>
                <button className="button button-stop" onClick={stopRecording}>
                  Finalizar
                </button>
              </>
            )}

            {status === 'saving' && (
              <button className="button button-secondary" disabled>
                Guardando fragmentos…
              </button>
            )}

            {status === 'stopped' && (
              <button className="button button-secondary" onClick={newRecording} disabled={isOptimizing}>
                Nueva grabación
              </button>
            )}
          </div>
        </section>

        <aside className="side-panel">
          <section className="settings-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">DISPOSITIVOS</span>
                <h2>Entrada</h2>
              </div>
              {(status === 'ready' || status === 'idle') && streamRef.current && (
                <button className="text-button" onClick={applyDevices} disabled={busy}>
                  Aplicar
                </button>
              )}
            </div>

            {mode === 'video' && (
              <label className="field">
                <span>Cámara</span>
                <select value={cameraId} onChange={(event) => setCameraId(event.target.value)} disabled={busy}>
                  <option value="">Predeterminada</option>
                  {devices.cameras.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Cámara ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="field">
              <span>Micrófono</span>
              <select
                value={microphoneId}
                onChange={(event) => setMicrophoneId(event.target.value)}
                disabled={busy}
              >
                <option value="">Predeterminado</option>
                {devices.microphones.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Micrófono ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>

            <div className="technical-grid">
              {mode === 'video' && (
                <>
                  <div>
                    <span>Resolución real</span>
                    <strong>
                      {resolution?.width && resolution?.height
                        ? `${resolution.width} × ${resolution.height}`
                        : '—'}
                    </strong>
                  </div>
                  <div>
                    <span>FPS reales</span>
                    <strong>{resolution?.frameRate ? Number(resolution.frameRate).toFixed(0) : '—'}</strong>
                  </div>
                </>
              )}
              <div>
                <span>Procesamiento</span>
                <strong>Local</strong>
              </div>
              <div>
                <span>Nube</span>
                <strong>No</strong>
              </div>
            </div>

            {mode === 'video' && resolution && !isFullHd && (
              <div className="inline-warning">
                La cámara está entregando {resolution.width} × {resolution.height}. La app pidió 1920 × 1080,
                pero el dispositivo o el navegador eligió una resolución menor.
              </div>
            )}
          </section>

          <section className="settings-card optimization-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">RESULTADO</span>
                <h2>Optimización</h2>
              </div>
            </div>

            <p className="card-copy">
              La grabación se prioriza para que sea fluida. La compresión pesada se hace después, nunca mientras grabas.
            </p>

            <div className="size-comparison">
              <div>
                <span>Original</span>
                <strong>{recordingBlob ? formatBytes(recordingBlob.size) : '—'}</strong>
              </div>
              <div>
                <span>Optimizado</span>
                <strong>{optimizedBlob ? formatBytes(optimizedBlob.size) : '—'}</strong>
              </div>
            </div>

            {isOptimizing && (
              <div className="progress-block">
                <div className="progress-label">
                  <span>Procesando localmente</span>
                  <strong>{Math.round(optimizationProgress * 100)}%</strong>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${optimizationProgress * 100}%` }} />
                </div>
                <small>No cierres esta pestaña hasta que termine.</small>
              </div>
            )}

            <div className="stacked-actions">
              <button
                className="button button-primary"
                onClick={optimizeRecording}
                disabled={!recordingBlob || isOptimizing || status !== 'stopped'}
              >
                {isOptimizing ? 'Optimizando…' : mode === 'video' ? 'Optimizar a Full HD' : 'Optimizar audio'}
              </button>

              <button
                className="button button-secondary"
                disabled={!recordingBlob || isOptimizing}
                onClick={() =>
                  downloadBlob(
                    recordingBlob,
                    timestampFilename(mode === 'video' ? 'video-original' : 'audio-original', originalExtension),
                  )
                }
              >
                Descargar original
              </button>

              <button
                className="button button-secondary"
                disabled={!optimizedBlob || isOptimizing}
                onClick={() =>
                  downloadBlob(
                    optimizedBlob,
                    timestampFilename(
                      mode === 'video' ? 'video-1080p-optimizado' : 'audio-optimizado',
                      optimizedExtension,
                    ),
                  )
                }
              >
                Descargar optimizado
              </button>
            </div>

            {optimizedUrl && mode === 'video' && (
              <details className="optimized-preview">
                <summary>Ver video optimizado</summary>
                <video src={optimizedUrl} controls playsInline />
              </details>
            )}

            {optimizedUrl && mode === 'audio' && (
              <details className="optimized-preview">
                <summary>Escuchar audio optimizado</summary>
                <audio src={optimizedUrl} controls />
              </details>
            )}
          </section>

          {recoveryMeta && status !== 'recording' && status !== 'paused' && !recordingBlob && (
            <section className="recovery-card">
              <div>
                <strong>Grabación local encontrada</strong>
                <span>Puedes recuperar los fragmentos guardados en este navegador.</span>
              </div>
              <button className="button button-secondary" onClick={recoverRecording}>
                Recuperar
              </button>
            </section>
          )}
        </aside>
      </main>

      {(error || notice) && (
        <div className={`toast ${error ? 'toast-error' : 'toast-success'}`} role="status">
          <span>{error || notice}</span>
          <button onClick={() => (error ? setError('') : setNotice(''))} aria-label="Cerrar mensaje">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
