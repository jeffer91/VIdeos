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

function timestampFilename(prefix, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}.${extension}`;
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

function deviceLabel(device, type, index) {
  if (device.label) return device.label;
  return `${type} ${index + 1}`;
}

export default function App() {
  const [mode, setMode] = useState('video');
  const [status, setStatus] = useState('detecting');
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
  const elapsedRef = useRef(0);
  const audioContextRef = useRef(null);
  const meterFrameRef = useRef(null);
  const mountedRef = useRef(true);

  const recordingUrl = useBlobUrl(recordingBlob);
  const optimizedUrl = useBlobUrl(optimizedBlob);

  const busy = ['detecting', 'recording', 'paused', 'saving'].includes(status) || isOptimizing;
  const isFullHd = resolution?.width >= 1920 && resolution?.height >= 1080;

  const statusText = useMemo(() => {
    if (isOptimizing) return 'Optimizando';
    const labels = {
      detecting: 'Detectando',
      idle: 'Sin dispositivo',
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
    if (mountedRef.current) setMicLevel(0);
  }

  function setupAudioMeter(stream) {
    cleanupAudioMeter();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !stream.getAudioTracks().length) return;

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    context.resume().catch(() => {});

    const samples = new Uint8Array(analyser.fftSize);
    audioContextRef.current = context;

    const draw = () => {
      if (!mountedRef.current) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / samples.length);
      setMicLevel(Math.min(100, Math.round(rms * 280)));
      meterFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
  }

  function stopMediaStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
    cleanupAudioMeter();
  }

  async function refreshDevices(stream = streamRef.current) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    if (!mountedRef.current) return;

    const cameras = list.filter((device) => device.kind === 'videoinput');
    const microphones = list.filter((device) => device.kind === 'audioinput');
    setDevices({ cameras, microphones });

    const videoDevice = stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId || '';
    const audioDevice = stream?.getAudioTracks?.()[0]?.getSettings?.().deviceId || '';

    setCameraId((current) => {
      if (videoDevice) return videoDevice;
      return cameras.some((device) => device.deviceId === current) ? current : '';
    });
    setMicrophoneId((current) => {
      if (audioDevice) return audioDevice;
      return microphones.some((device) => device.deviceId === current) ? current : '';
    });
  }

  function buildConstraints(targetMode, targetCameraId, targetMicrophoneId, useExactDevices = true) {
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
      ...(useExactDevices && targetMicrophoneId ? { deviceId: { exact: targetMicrophoneId } } : {}),
    };

    const video = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 30, max: 30 },
      ...(useExactDevices && targetCameraId ? { deviceId: { exact: targetCameraId } } : {}),
    };

    return { audio, video: targetMode === 'video' ? video : false };
  }

  async function openStream(overrides = {}) {
    setError('');
    setNotice('');

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Electron no tiene acceso a los dispositivos multimedia en este equipo.');
      setStatus('idle');
      return null;
    }

    const targetMode = overrides.mode ?? mode;
    const targetCameraId = overrides.cameraId ?? cameraId;
    const targetMicrophoneId = overrides.microphoneId ?? microphoneId;

    setStatus('detecting');
    stopMediaStream();

    let stream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          buildConstraints(targetMode, targetCameraId, targetMicrophoneId, true),
        );
      } catch (firstError) {
        if (!['OverconstrainedError', 'NotFoundError', 'DevicesNotFoundError'].includes(firstError?.name)) {
          throw firstError;
        }
        stream = await navigator.mediaDevices.getUserMedia(
          buildConstraints(targetMode, '', '', false),
        );
      }

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }

      streamRef.current = stream;
      setupAudioMeter(stream);

      if (targetMode === 'video') {
        const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
        setResolution({
          width: settings.width || 0,
          height: settings.height || 0,
          frameRate: settings.frameRate || 0,
        });

        requestAnimationFrame(() => {
          if (liveVideoRef.current && streamRef.current === stream) {
            liveVideoRef.current.srcObject = stream;
            liveVideoRef.current.play().catch(() => {});
          }
        });
      } else {
        setResolution(null);
      }

      await refreshDevices(stream);
      if (mountedRef.current) setStatus('ready');
      return stream;
    } catch (caught) {
      console.error(caught);
      await refreshDevices(null).catch(() => {});
      if (!mountedRef.current) return null;

      const message =
        caught?.name === 'NotAllowedError' || caught?.name === 'PermissionDeniedError'
          ? 'Windows o Electron bloqueó la cámara/micrófono. Habilita el acceso en Configuración > Privacidad y seguridad > Cámara y Micrófono.'
          : caught?.name === 'NotReadableError' || caught?.name === 'TrackStartError'
            ? 'La cámara o el micrófono están ocupados por otra aplicación. Cierra la otra app y pulsa Reintentar.'
            : 'No se pudo abrir la cámara o el micrófono. Revisa que estén conectados y habilitados en Windows.';
      setError(message);
      setStatus('idle');
      return null;
    }
  }

  function updateElapsed() {
    if (!recordingStartedAtRef.current) return;
    const now = Date.now();
    const currentPause = pausedStartedAtRef.current ? now - pausedStartedAtRef.current : 0;
    const value = now - recordingStartedAtRef.current - pausedTotalRef.current - currentPause;
    elapsedRef.current = value;
    setElapsedMs(value);
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
    mountedRef.current = true;

    const initialise = async () => {
      try {
        const meta = await getRecordingMeta();
        const chunks = meta ? await getChunks() : [];
        if (mountedRef.current && meta && chunks.length) setRecoveryMeta(meta);
      } catch (caught) {
        console.warn('No se pudo comprobar la recuperación local.', caught);
      }

      await openStream({ mode: 'video', cameraId: '', microphoneId: '' });
    };

    const onDeviceChange = () => {
      refreshDevices(streamRef.current).catch(() => {});
    };

    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    initialise();

    return () => {
      mountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
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
      // Optional in Electron.
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
        setError('La grabación encontró un error. Finaliza la sesión para conservar los fragmentos disponibles.');
      };

      recorder.onstop = async () => {
        try {
          const writeResults = await Promise.allSettled(pendingWritesRef.current);
          if (writeResults.some((result) => result.status === 'rejected')) {
            throw new Error('No se pudieron guardar todos los fragmentos.');
          }

          const rows = await getChunks();
          if (!rows.length) throw new Error('La grabación no produjo datos.');

          const blob = new Blob(rows.map((row) => row.blob), {
            type: recorder.mimeType || mimeType || rows[0].blob.type,
          });
          const trackSettings = stream.getVideoTracks()[0]?.getSettings?.() || {};
          const meta = {
            sessionId,
            status: 'stopped',
            mode,
            mimeType: blob.type,
            width: trackSettings.width || 0,
            height: trackSettings.height || 0,
            frameRate: trackSettings.frameRate || 0,
            durationMs: elapsedRef.current,
            createdAt: Date.now(),
          };

          setRecordingBlob(blob);
          await setRecordingMeta(meta);
          setRecoveryMeta(meta);
          setStatus('stopped');
          setNotice('Grabación lista. Puedes reproducirla, optimizarla o descargarla.');
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
      elapsedRef.current = 0;
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
      setError('No se pudo iniciar la grabación. Revisa permisos y espacio disponible.');
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
      if (!meta || !rows.length) throw new Error('No hay una grabación recuperable.');

      stopMediaStream();
      const recovered = new Blob(rows.map((row) => row.blob), {
        type: meta.mimeType || rows[0].blob.type,
      });
      setMode(meta.mode || 'video');
      setRecordingBlob(recovered);
      setOptimizedBlob(null);
      elapsedRef.current = meta.durationMs || 0;
      setElapsedMs(elapsedRef.current);
      if (meta.mode === 'video' && meta.width && meta.height) {
        setResolution({ width: meta.width, height: meta.height, frameRate: meta.frameRate || 0 });
      }
      setStatus('stopped');
      setNotice('Se recuperó la última grabación local.');
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
          ? 'Optimización completada manteniendo Full HD.'
          : 'Optimización completada. El original ya estaba muy comprimido.',
      );
    } catch (caught) {
      console.error(caught);
      setError('No se pudo optimizar este archivo. El original permanece intacto.');
    } finally {
      setIsOptimizing(false);
    }
  }

  async function newRecording() {
    stopMediaStream();
    setRecordingBlob(null);
    setOptimizedBlob(null);
    setOptimizationProgress(0);
    elapsedRef.current = 0;
    setElapsedMs(0);
    setResolution(null);
    setNotice('');
    setError('');
    setRecoveryMeta(null);
    await clearRecordingData().catch(() => {});
    await openStream({ mode, cameraId, microphoneId });
  }

  async function changeMode(nextMode) {
    if (busy || nextMode === mode) return;
    setMode(nextMode);
    setRecordingBlob(null);
    setOptimizedBlob(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
    setError('');
    setNotice('');
    await openStream({ mode: nextMode, cameraId, microphoneId });
  }

  async function changeCamera(nextId) {
    setCameraId(nextId);
    if (!busy && status !== 'stopped') {
      await openStream({ mode, cameraId: nextId, microphoneId });
    }
  }

  async function changeMicrophone(nextId) {
    setMicrophoneId(nextId);
    if (!busy && status !== 'stopped') {
      await openStream({ mode, cameraId, microphoneId: nextId });
    }
  }

  const originalExtension = recordingBlob ? extensionFor(recordingBlob, mode) : 'webm';
  const optimizedExtension = mode === 'video' ? 'mp4' : 'm4a';
  const cameraCount = devices.cameras.length;
  const microphoneCount = devices.microphones.length;

  return (
    <div className="app-shell compact-shell">
      <header className="topbar compact-topbar">
        <div>
          <div className="brand">Videos</div>
          <p className="subtitle">Grabación local · 1080p · sin nube</p>
        </div>
        <div className={`status-pill status-${status}${isOptimizing ? ' status-optimizing' : ''}`}>
          <span className="status-dot" />
          {statusText}
        </div>
      </header>

      <main className="workspace compact-workspace">
        <section className="recorder-panel compact-recorder">
          <div className="panel-toolbar compact-toolbar">
            <div className="mode-switch" role="group" aria-label="Modo de grabación">
              <button className={mode === 'video' ? 'active' : ''} onClick={() => changeMode('video')} disabled={busy}>
                Video + audio
              </button>
              <button className={mode === 'audio' ? 'active' : ''} onClick={() => changeMode('audio')} disabled={busy}>
                Solo audio
              </button>
            </div>
            <div className="quality-badges">
              {mode === 'video' && <span>16:9</span>}
              {mode === 'video' && <span>1080p</span>}
              <span>30 fps</span>
            </div>
          </div>

          <div className={`media-stage compact-stage ${mode === 'audio' ? 'audio-stage' : ''}`}>
            {mode === 'video' ? (
              recordingUrl && status === 'stopped' ? (
                <video className="playback" src={recordingUrl} controls playsInline />
              ) : (
                <video className="live-video" ref={liveVideoRef} muted autoPlay playsInline />
              )
            ) : recordingUrl && status === 'stopped' ? (
              <div className="audio-playback-card">
                <div className="audio-icon">AUDIO</div>
                <audio src={recordingUrl} controls />
              </div>
            ) : (
              <div className="audio-live-card">
                <div className="audio-icon">MIC</div>
                <h2>{status === 'detecting' ? 'Detectando micrófono…' : 'Micrófono preparado'}</h2>
                <p>48 kHz cuando el dispositivo lo permite.</p>
              </div>
            )}

            {mode === 'video' && !recordingUrl && status !== 'ready' && status !== 'recording' && status !== 'paused' && (
              <div className="stage-placeholder">
                <strong>{status === 'detecting' ? 'Detectando cámara…' : 'Cámara no disponible'}</strong>
                <span>{status === 'detecting' ? 'Buscando cámaras y micrófonos conectados.' : 'Revisa permisos o pulsa Reintentar.'}</span>
              </div>
            )}

            {(status === 'recording' || status === 'paused') && (
              <div className="recording-overlay">
                <span className="rec-dot" />
                {status === 'paused' ? 'PAUSA' : 'REC'}
              </div>
            )}
          </div>

          <div className="recorder-footer">
            <div className="footer-meter">
              <span>MIC</span>
              <div className="meter-track">
                <div className="meter-fill" style={{ width: `${Math.max(streamRef.current ? 2 : 0, micLevel)}%` }} />
              </div>
              <strong>{micLevel}%</strong>
            </div>

            <div className="timer compact-timer">{formatTime(elapsedMs)}</div>

            <div className="primary-controls compact-controls">
              {status === 'detecting' && <button className="button button-secondary" disabled>Detectando…</button>}
              {status === 'idle' && (
                <button className="button button-secondary" onClick={() => openStream({ mode, cameraId, microphoneId })}>
                  Reintentar
                </button>
              )}
              {status === 'ready' && (
                <button className="button button-record" onClick={startRecording}>
                  <span className="button-rec-dot" /> Grabar
                </button>
              )}
              {status === 'recording' && (
                <>
                  <button className="button button-secondary" onClick={pauseRecording}>Pausar</button>
                  <button className="button button-stop" onClick={stopRecording}>Finalizar</button>
                </>
              )}
              {status === 'paused' && (
                <>
                  <button className="button button-primary" onClick={resumeRecording}>Continuar</button>
                  <button className="button button-stop" onClick={stopRecording}>Finalizar</button>
                </>
              )}
              {status === 'saving' && <button className="button button-secondary" disabled>Guardando…</button>}
              {status === 'stopped' && (
                <button className="button button-secondary" onClick={newRecording} disabled={isOptimizing}>Nueva</button>
              )}
            </div>
          </div>
        </section>

        <aside className="side-panel compact-side">
          <section className="settings-card compact-card">
            <div className="section-heading compact-heading">
              <div>
                <span className="eyebrow">DISPOSITIVOS</span>
                <h2>Entrada</h2>
              </div>
              <button
                className="text-button"
                onClick={() => openStream({ mode, cameraId, microphoneId })}
                disabled={['recording', 'paused', 'saving'].includes(status) || isOptimizing}
              >
                Actualizar
              </button>
            </div>

            {mode === 'video' && (
              <label className="field compact-field">
                <span>Cámara · {cameraCount}</span>
                <select value={cameraId} onChange={(event) => changeCamera(event.target.value)} disabled={busy || status === 'stopped'}>
                  <option value="">Predeterminada</option>
                  {devices.cameras.map((device, index) => (
                    <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>
                      {deviceLabel(device, 'Cámara', index)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="field compact-field">
              <span>Micrófono · {microphoneCount}</span>
              <select value={microphoneId} onChange={(event) => changeMicrophone(event.target.value)} disabled={busy || status === 'stopped'}>
                <option value="">Predeterminado</option>
                {devices.microphones.map((device, index) => (
                  <option key={device.deviceId || `microphone-${index}`} value={device.deviceId}>
                    {deviceLabel(device, 'Micrófono', index)}
                  </option>
                ))}
              </select>
            </label>

            <div className="technical-grid compact-technical">
              {mode === 'video' && (
                <>
                  <div><span>Resolución</span><strong>{resolution?.width ? `${resolution.width} × ${resolution.height}` : '—'}</strong></div>
                  <div><span>FPS</span><strong>{resolution?.frameRate ? Number(resolution.frameRate).toFixed(0) : '—'}</strong></div>
                </>
              )}
              <div><span>Cámaras</span><strong>{cameraCount}</strong></div>
              <div><span>Micrófonos</span><strong>{microphoneCount}</strong></div>
            </div>

            {mode === 'video' && resolution && !isFullHd && (
              <div className="inline-warning compact-warning">
                Cámara actual: {resolution.width} × {resolution.height}. La app solicita 1920 × 1080.
              </div>
            )}
          </section>

          <section className="settings-card optimization-card compact-card">
            <div className="section-heading compact-heading">
              <div><span className="eyebrow">RESULTADO</span><h2>Optimización</h2></div>
            </div>

            <p className="card-copy compact-copy">La compresión se ejecuta después de grabar para mantener la captura fluida.</p>

            <div className="size-comparison compact-sizes">
              <div><span>Original</span><strong>{recordingBlob ? formatBytes(recordingBlob.size) : '—'}</strong></div>
              <div><span>Optimizado</span><strong>{optimizedBlob ? formatBytes(optimizedBlob.size) : '—'}</strong></div>
            </div>

            {isOptimizing && (
              <div className="progress-block compact-progress">
                <div className="progress-label"><span>Procesando</span><strong>{Math.round(optimizationProgress * 100)}%</strong></div>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${optimizationProgress * 100}%` }} /></div>
              </div>
            )}

            <div className="stacked-actions compact-actions">
              <button className="button button-primary" onClick={optimizeRecording} disabled={!recordingBlob || isOptimizing || status !== 'stopped'}>
                {isOptimizing ? 'Optimizando…' : mode === 'video' ? 'Optimizar Full HD' : 'Optimizar audio'}
              </button>
              <button
                className="button button-secondary"
                disabled={!recordingBlob || isOptimizing}
                onClick={() => downloadBlob(recordingBlob, timestampFilename(mode === 'video' ? 'video-original' : 'audio-original', originalExtension))}
              >
                Descargar original
              </button>
              <button
                className="button button-secondary"
                disabled={!optimizedBlob || isOptimizing}
                onClick={() => downloadBlob(optimizedBlob, timestampFilename(mode === 'video' ? 'video-1080p-optimizado' : 'audio-optimizado', optimizedExtension))}
              >
                Descargar optimizado
              </button>
            </div>

            {optimizedUrl && mode === 'video' && (
              <details className="optimized-preview"><summary>Ver optimizado</summary><video src={optimizedUrl} controls playsInline /></details>
            )}
            {optimizedUrl && mode === 'audio' && (
              <details className="optimized-preview"><summary>Escuchar optimizado</summary><audio src={optimizedUrl} controls /></details>
            )}
          </section>

          {recoveryMeta && status !== 'recording' && status !== 'paused' && !recordingBlob && (
            <section className="recovery-card compact-recovery">
              <div><strong>Grabación encontrada</strong><span>Hay fragmentos locales recuperables.</span></div>
              <button className="button button-secondary" onClick={recoverRecording}>Recuperar</button>
            </section>
          )}
        </aside>
      </main>

      {(error || notice) && (
        <div className={`toast ${error ? 'toast-error' : 'toast-success'}`} role="status">
          <span>{error || notice}</span>
          <button onClick={() => (error ? setError('') : setNotice(''))} aria-label="Cerrar mensaje">×</button>
        </div>
      )}
    </div>
  );
}
