import { useEffect, useMemo, useRef, useState } from 'react';
import { optimizeMedia } from './ffmpeg';
import { parseSlides } from './parser';
import {
  clearRecordingData,
  getActiveProject,
  getChunks,
  getProjectTakes,
  getRecordingMeta,
  saveChunk,
  saveProject,
  saveSlideTake,
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
  if (!bytes) return '—';
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
  return device.label || `${type} ${index + 1}`;
}

function rowsToMap(rows = []) {
  return Object.fromEntries(rows.map((take) => [take.slideNumber, take]));
}

function slideState(take) {
  if (take?.accepted) return 'accepted';
  if (take?.blob) return 'review';
  return 'pending';
}

export default function App() {
  const [view, setView] = useState('content');
  const [project, setProject] = useState(null);
  const [takes, setTakes] = useState({});
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [rawText, setRawText] = useState('');
  const [parseResult, setParseResult] = useState(null);

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
  const [recoveryMeta, setRecoveryMeta] = useState(null);

  const [prompterFontSize, setPrompterFontSize] = useState(25);
  const [prompterSpeed, setPrompterSpeed] = useState(34);
  const [prompterRunning, setPrompterRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
  const prompterRef = useRef(null);

  const recordingUrl = useBlobUrl(recordingBlob);
  const optimizedUrl = useBlobUrl(optimizedBlob);
  const currentSlide = project?.slides?.[currentSlideIndex] || null;
  const currentTake = currentSlide ? takes[currentSlide.number] : null;
  const busy = ['detecting', 'recording', 'paused', 'saving'].includes(status) || isOptimizing;
  const isFullHd = resolution?.width >= 1920 && resolution?.height >= 1080;

  const acceptedCount = useMemo(
    () => (project?.slides || []).filter((slide) => takes[slide.number]?.accepted).length,
    [project, takes],
  );
  const reviewCount = useMemo(
    () => (project?.slides || []).filter((slide) => takes[slide.number]?.blob && !takes[slide.number]?.accepted).length,
    [project, takes],
  );

  const statusText = useMemo(() => {
    if (isOptimizing) return 'Optimizando';
    return {
      detecting: 'Detectando',
      idle: 'Sin dispositivo',
      ready: 'Listo',
      recording: 'Grabando',
      paused: 'Pausado',
      saving: 'Guardando',
      stopped: currentTake?.accepted ? 'Aceptada' : 'Revisar toma',
    }[status] || 'Listo';
  }, [isOptimizing, status, currentTake]);

  function cleanupAudioMeter() {
    if (meterFrameRef.current) cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    audioContextRef.current = null;
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
      setMicLevel(Math.min(100, Math.round(Math.sqrt(sum / samples.length) * 280)));
      meterFrameRef.current = requestAnimationFrame(draw);
    };
    draw();
  }

  function stopMediaStream() {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
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
    setCameraId((current) => videoDevice || (cameras.some((device) => device.deviceId === current) ? current : ''));
    setMicrophoneId((current) => audioDevice || (microphones.some((device) => device.deviceId === current) ? current : ''));
  }

  function buildConstraints(targetMode, targetCameraId, targetMicrophoneId, exact = true) {
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
      ...(exact && targetMicrophoneId ? { deviceId: { exact: targetMicrophoneId } } : {}),
    };
    const video = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: 30, max: 30 },
      ...(exact && targetCameraId ? { deviceId: { exact: targetCameraId } } : {}),
    };
    return { audio, video: targetMode === 'video' ? video : false };
  }

  async function openStream(overrides = {}) {
    setError('');
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

    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          buildConstraints(targetMode, targetCameraId, targetMicrophoneId, true),
        );
      } catch (firstError) {
        if (!['OverconstrainedError', 'NotFoundError', 'DevicesNotFoundError'].includes(firstError?.name)) throw firstError;
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(targetMode, '', '', false));
      }

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }

      streamRef.current = stream;
      setupAudioMeter(stream);
      if (targetMode === 'video') {
        const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
        setResolution({ width: settings.width || 0, height: settings.height || 0, frameRate: settings.frameRate || 0 });
        requestAnimationFrame(() => {
          if (liveVideoRef.current && streamRef.current === stream) {
            liveVideoRef.current.srcObject = stream;
            liveVideoRef.current.play().catch(() => {});
          }
        });
      } else setResolution(null);

      await refreshDevices(stream);
      if (mountedRef.current) setStatus('ready');
      return stream;
    } catch (caught) {
      console.error(caught);
      await refreshDevices(null).catch(() => {});
      if (!mountedRef.current) return null;
      const message =
        caught?.name === 'NotAllowedError' || caught?.name === 'PermissionDeniedError'
          ? 'Windows o Electron bloqueó la cámara/micrófono. Habilita el acceso en Privacidad y seguridad.'
          : caught?.name === 'NotReadableError' || caught?.name === 'TrackStartError'
            ? 'La cámara o el micrófono están ocupados por otra aplicación.'
            : 'No se pudo abrir la cámara o el micrófono. Revisa que estén conectados.';
      setError(message);
      setStatus('idle');
      return null;
    }
  }

  function resetPrompter() {
    setPrompterRunning(false);
    if (prompterRef.current) prompterRef.current.scrollTop = 0;
  }

  useEffect(() => {
    if (!prompterRunning) return undefined;
    let frame;
    let last = performance.now();
    const move = (now) => {
      const box = prompterRef.current;
      if (!box) return;
      const delta = Math.min(80, now - last);
      last = now;
      box.scrollTop += (prompterSpeed * delta) / 1000;
      const finished = box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
      if (finished) setPrompterRunning(false);
      else frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, [prompterRunning, prompterSpeed, currentSlideIndex]);

  function updateElapsed() {
    if (!recordingStartedAtRef.current) return;
    const now = Date.now();
    const currentPause = pausedStartedAtRef.current ? now - pausedStartedAtRef.current : 0;
    const value = now - recordingStartedAtRef.current - pausedTotalRef.current - currentPause;
    elapsedRef.current = value;
    setElapsedMs(value);
  }

  useEffect(() => {
    if (!['recording', 'paused'].includes(status)) return undefined;
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 200);
    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;
    const initialise = async () => {
      try {
        const active = await getActiveProject();
        const recordingMeta = await getRecordingMeta();
        const chunks = recordingMeta ? await getChunks() : [];
        if (recordingMeta && chunks.length) setRecoveryMeta(recordingMeta);

        if (active) {
          const rows = await getProjectTakes(active.id);
          const mapped = rowsToMap(rows);
          setProject(active);
          setTakes(mapped);
          const firstPending = active.slides.findIndex((slide) => !mapped[slide.number]?.accepted);
          setCurrentSlideIndex(firstPending >= 0 ? firstPending : 0);
          setView('recording');
        } else {
          await refreshDevices(null).catch(() => {});
        }
      } catch (caught) {
        console.error(caught);
        setError('No se pudo cargar el proyecto local.');
      }
    };

    const onDeviceChange = () => refreshDevices(streamRef.current).catch(() => {});
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    initialise();

    return () => {
      mountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      stopMediaStream();
    };
  }, []);

  useEffect(() => {
    resetPrompter();
    if (view !== 'recording' || !project || !currentSlide) {
      stopMediaStream();
      return;
    }

    const take = takes[currentSlide.number];
    if (take?.blob) {
      stopMediaStream();
      setRecordingBlob(take.blob);
      setOptimizedBlob(take.optimizedBlob || null);
      setMode(take.mode || 'video');
      elapsedRef.current = take.durationMs || 0;
      setElapsedMs(elapsedRef.current);
      if (take.width && take.height) {
        setResolution({ width: take.width, height: take.height, frameRate: take.frameRate || 0 });
      }
      setStatus('stopped');
      return;
    }

    setRecordingBlob(null);
    setOptimizedBlob(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
    openStream({ mode, cameraId, microphoneId });
  }, [view, currentSlideIndex, project?.id]);

  function navigate(nextView) {
    if (['recording', 'paused', 'saving'].includes(status)) {
      setError('Finaliza la grabación antes de cambiar de pantalla.');
      return;
    }
    setError('');
    setView(nextView);
  }

  function parseContent() {
    const result = parseSlides(rawText);
    setParseResult(result);
    setError(result.errors[0] || '');
  }

  async function loadTextFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    const result = parseSlides(text);
    setParseResult(result);
    setError(result.errors[0] || '');
  }

  async function createProject() {
    const result = parseResult || parseSlides(rawText);
    setParseResult(result);
    if (result.errors.length || !result.slides.length) {
      setError(result.errors[0] || 'No hay diapositivas válidas.');
      return;
    }

    const id = `project-${Date.now()}`;
    const nextProject = {
      id,
      name: result.slides[0]?.title || 'Proyecto de video',
      rawText,
      slides: result.slides,
      createdAt: Date.now(),
    };
    await saveProject(nextProject);
    await clearRecordingData().catch(() => {});
    setProject(nextProject);
    setTakes({});
    setCurrentSlideIndex(0);
    setParseResult(null);
    setView('recording');
    setNotice(`Proyecto creado con ${result.slides.length} diapositivas.`);
    setError('');
  }

  async function startRecording() {
    if (!project || !currentSlide) return;
    setError('');
    setNotice('');
    setOptimizedBlob(null);
    setOptimizationProgress(0);
    let stream = streamRef.current;
    if (!stream) stream = await openStream();
    if (!stream) return;

    try {
      await navigator.storage?.persist?.();
      await clearRecordingData();
      pendingWritesRef.current = [];
      chunkIndexRef.current = 0;
      setRecordingBlob(null);

      const mimeType = chooseMimeType(mode);
      const options = mimeType ? { mimeType } : {};
      if (mode === 'video') {
        options.videoBitsPerSecond = 8_000_000;
        options.audioBitsPerSecond = 128_000;
      } else options.audioBitsPerSecond = 128_000;

      const recorder = new MediaRecorder(stream, options);
      const sessionId = makeSessionId();
      const slideNumber = currentSlide.number;
      const projectId = project.id;
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (!event.data?.size) return;
        const index = chunkIndexRef.current++;
        pendingWritesRef.current.push(saveChunk({ blob: event.data, index, sessionId }));
      };

      recorder.onerror = (event) => {
        console.error(event.error || event);
        setError('La grabación encontró un error. Finaliza para conservar lo disponible.');
      };

      recorder.onstop = async () => {
        try {
          const results = await Promise.allSettled(pendingWritesRef.current);
          if (results.some((result) => result.status === 'rejected')) throw new Error('No se guardaron todos los fragmentos.');
          const rows = await getChunks();
          if (!rows.length) throw new Error('La grabación no produjo datos.');
          const blob = new Blob(rows.map((row) => row.blob), {
            type: recorder.mimeType || mimeType || rows[0].blob.type,
          });
          const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
          const take = {
            blob,
            optimizedBlob: null,
            accepted: false,
            mode,
            mimeType: blob.type,
            durationMs: elapsedRef.current,
            width: settings.width || 0,
            height: settings.height || 0,
            frameRate: settings.frameRate || 0,
            createdAt: Date.now(),
          };
          await saveSlideTake(projectId, slideNumber, take);
          await clearRecordingData();
          setTakes((previous) => ({ ...previous, [slideNumber]: take }));
          setRecordingBlob(blob);
          setOptimizedBlob(null);
          setStatus('stopped');
          setRecoveryMeta(null);
          setNotice(`Toma de la diapositiva ${slideNumber} lista para revisar.`);
        } catch (caught) {
          console.error(caught);
          setError(caught.message || 'No se pudo preparar la grabación final.');
          setStatus('idle');
        } finally {
          setPrompterRunning(false);
          stopMediaStream();
          recorderRef.current = null;
        }
      };

      recordingStartedAtRef.current = Date.now();
      pausedStartedAtRef.current = 0;
      pausedTotalRef.current = 0;
      elapsedRef.current = 0;
      setElapsedMs(0);
      resetPrompter();
      setPrompterRunning(true);

      await setRecordingMeta({
        sessionId,
        status: 'recording',
        projectId,
        slideNumber,
        mode,
        mimeType: recorder.mimeType || mimeType,
        createdAt: Date.now(),
      });
      recorder.start(1000);
      setStatus('recording');
    } catch (caught) {
      console.error(caught);
      setPrompterRunning(false);
      setError('No se pudo iniciar la grabación. Revisa permisos y espacio disponible.');
    }
  }

  function pauseRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    pausedStartedAtRef.current = Date.now();
    setPrompterRunning(false);
    setStatus('paused');
  }

  function resumeRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    pausedTotalRef.current += Date.now() - pausedStartedAtRef.current;
    pausedStartedAtRef.current = 0;
    setPrompterRunning(true);
    setStatus('recording');
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    updateElapsed();
    setPrompterRunning(false);
    recorder.stop();
    setStatus('saving');
  }

  async function repeatCurrentSlide() {
    if (!currentSlide || isOptimizing) return;
    setRecordingBlob(null);
    setOptimizedBlob(null);
    setOptimizationProgress(0);
    elapsedRef.current = 0;
    setElapsedMs(0);
    resetPrompter();
    await openStream({ mode, cameraId, microphoneId });
    setNotice('La nueva toma reemplazará la anterior cuando finalices.');
  }

  async function acceptCurrentTake() {
    if (!currentSlide || !recordingBlob) return;
    const previous = takes[currentSlide.number] || {};
    const updated = {
      ...previous,
      blob: recordingBlob,
      optimizedBlob: optimizedBlob || previous.optimizedBlob || null,
      accepted: true,
      mode,
      durationMs: elapsedRef.current,
    };
    await saveSlideTake(project.id, currentSlide.number, updated);
    setTakes((old) => ({ ...old, [currentSlide.number]: updated }));
    setNotice(`Diapositiva ${currentSlide.number} aceptada.`);

    if (currentSlideIndex < project.slides.length - 1) {
      setCurrentSlideIndex((index) => index + 1);
    } else {
      const pending = project.slides.findIndex((slide) => slide.number !== currentSlide.number && !takes[slide.number]?.accepted);
      if (pending >= 0) setCurrentSlideIndex(pending);
      else setView('result');
    }
  }

  async function optimizeRecording() {
    if (!recordingBlob || !currentSlide || isOptimizing) return;
    setError('');
    setNotice('');
    setIsOptimizing(true);
    setOptimizationProgress(0);
    try {
      const result = await optimizeMedia(recordingBlob, mode, setOptimizationProgress);
      const previous = takes[currentSlide.number] || {};
      const updated = {
        ...previous,
        blob: recordingBlob,
        optimizedBlob: result,
        accepted: !!previous.accepted,
        mode,
        durationMs: elapsedRef.current,
      };
      await saveSlideTake(project.id, currentSlide.number, updated);
      setTakes((old) => ({ ...old, [currentSlide.number]: updated }));
      setOptimizedBlob(result);
      setNotice(result.size < recordingBlob.size ? 'Optimización completada.' : 'Optimización completada; el original ya era compacto.');
    } catch (caught) {
      console.error(caught);
      setError('No se pudo optimizar este archivo. El original permanece intacto.');
    } finally {
      setIsOptimizing(false);
    }
  }

  async function recoverRecording() {
    try {
      const meta = await getRecordingMeta();
      const rows = await getChunks();
      if (!meta || !rows.length || !meta.projectId || !meta.slideNumber) throw new Error('No hay una toma recuperable.');
      const blob = new Blob(rows.map((row) => row.blob), { type: meta.mimeType || rows[0].blob.type });
      const take = {
        blob,
        optimizedBlob: null,
        accepted: false,
        mode: meta.mode || 'video',
        mimeType: blob.type,
        durationMs: rows.length * 1000,
        createdAt: meta.createdAt || Date.now(),
      };
      await saveSlideTake(meta.projectId, meta.slideNumber, take);
      await clearRecordingData();
      if (project?.id === meta.projectId) {
        const index = project.slides.findIndex((slide) => slide.number === meta.slideNumber);
        setTakes((old) => ({ ...old, [meta.slideNumber]: take }));
        if (index >= 0) setCurrentSlideIndex(index);
        setView('recording');
      }
      setRecoveryMeta(null);
      setNotice(`Se recuperó la toma de la diapositiva ${meta.slideNumber}.`);
    } catch (caught) {
      setError(caught.message || 'No se pudo recuperar la grabación.');
    }
  }

  async function goToSlide(index) {
    if (!project || index < 0 || index >= project.slides.length) return;
    if (['recording', 'paused', 'saving'].includes(status)) {
      setError('Finaliza la toma antes de cambiar de diapositiva.');
      return;
    }
    setError('');
    setCurrentSlideIndex(index);
    setView('recording');
  }

  async function changeMode(nextMode) {
    if (busy || nextMode === mode || currentTake?.blob) return;
    setMode(nextMode);
    await openStream({ mode: nextMode, cameraId, microphoneId });
  }

  async function changeCamera(nextId) {
    setCameraId(nextId);
    if (!busy && status !== 'stopped') await openStream({ mode, cameraId: nextId, microphoneId });
  }

  async function changeMicrophone(nextId) {
    setMicrophoneId(nextId);
    if (!busy && status !== 'stopped') await openStream({ mode, cameraId, microphoneId: nextId });
  }

  const slideWindow = useMemo(() => {
    if (!project) return [];
    const start = Math.max(0, Math.min(currentSlideIndex - 3, project.slides.length - 7));
    return project.slides.slice(start, start + 7);
  }, [project, currentSlideIndex]);

  const originalExtension = extensionFor(recordingBlob, mode);
  const optimizedExtension = mode === 'video' ? 'mp4' : 'm4a';

  return (
    <div className="studio-app">
      <header className="studio-header">
        <div className="studio-brand">
          <strong>Videos Studio</strong>
          <span>Grabación por diapositivas · local</span>
        </div>
        <nav className="studio-nav" aria-label="Secciones">
          {[
            ['content', 'Contenido'],
            ['recording', 'Grabación'],
            ['project', 'Proyecto'],
            ['result', 'Resultado'],
          ].map(([key, label]) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => navigate(key)} disabled={!project && key !== 'content'}>
              {label}
            </button>
          ))}
        </nav>
        <div className="studio-progress">
          {project ? <><strong>{acceptedCount}/{project.slides.length}</strong><span>aceptadas</span></> : <><strong>Nuevo</strong><span>proyecto</span></>}
        </div>
      </header>

      <main className="studio-main">
        {view === 'content' && (
          <section className="content-screen">
            <div className="screen-heading">
              <div><span className="eyebrow">PANTALLA 1</span><h1>Cargar contenido</h1><p>Pega el texto o carga un TXT. La app conserva literalmente TÍTULO, CUERPO y CONTENIDO.</p></div>
              {project && <button className="ghost-button" onClick={() => navigate('recording')}>Volver a grabación</button>}
            </div>

            <div className="content-grid">
              <div className="paste-card">
                <div className="card-title-row"><strong>Contenido fuente</strong><label className="file-button">Cargar TXT<input type="file" accept=".txt,text/plain" onChange={loadTextFile} /></label></div>
                <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder={'DIAPOSITIVA 1\nTÍTULO:\n...\n\nCUERPO:\n- ...\n\nCONTENIDO:\n- ...\n\n//'} />
                <button className="primary-button" onClick={parseContent} disabled={!rawText.trim()}>Procesar diapositivas</button>
              </div>

              <div className="parse-card">
                <div className="card-title-row"><strong>Validación</strong>{parseResult && <span className="count-badge">{parseResult.slides.length} detectadas</span>}</div>
                {!parseResult && <div className="empty-state">Procesa el texto para revisar las diapositivas antes de grabar.</div>}
                {parseResult && (
                  <>
                    {!!parseResult.errors.length && <div className="validation error-box">{parseResult.errors.map((item) => <div key={item}>• {item}</div>)}</div>}
                    {!!parseResult.warnings.length && <div className="validation warning-box">{parseResult.warnings.slice(0, 4).map((item) => <div key={item}>• {item}</div>)}</div>}
                    <div className="parsed-list">
                      {parseResult.slides.map((slide) => <div className="parsed-row" key={slide.number}><span>{String(slide.number).padStart(2, '0')}</span><strong>{slide.title || 'Sin título'}</strong></div>)}
                    </div>
                    <button className="primary-button" onClick={createProject} disabled={!!parseResult.errors.length}>Crear proyecto y grabar</button>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {view === 'recording' && project && currentSlide && (
          <section className="recording-screen">
            <div className="slide-header">
              <button className="icon-button" onClick={() => goToSlide(currentSlideIndex - 1)} disabled={currentSlideIndex === 0 || busy}>←</button>
              <div className="slide-title"><span>DIAPOSITIVA {currentSlide.number} DE {project.slides.length}</span><h1>{currentSlide.title}</h1></div>
              <button className="icon-button" onClick={() => goToSlide(currentSlideIndex + 1)} disabled={currentSlideIndex === project.slides.length - 1 || busy}>→</button>
            </div>

            <div className="slide-rail">
              {slideWindow.map((slide) => {
                const index = project.slides.findIndex((item) => item.number === slide.number);
                const state = slideState(takes[slide.number]);
                return <button key={slide.number} className={`${index === currentSlideIndex ? 'current' : ''} ${state}`} onClick={() => goToSlide(index)} disabled={busy}><span>{slide.number}</span><small>{state === 'accepted' ? '✓' : state === 'review' ? '◐' : '○'}</small></button>;
              })}
            </div>

            <div className="recording-workspace">
              <div className="camera-card">
                <div className="recording-toolbar">
                  <div className="mode-switch">
                    <button className={mode === 'video' ? 'active' : ''} onClick={() => changeMode('video')} disabled={busy || !!currentTake?.blob}>Video + audio</button>
                    <button className={mode === 'audio' ? 'active' : ''} onClick={() => changeMode('audio')} disabled={busy || !!currentTake?.blob}>Solo audio</button>
                  </div>
                  <div className="device-inline">
                    {mode === 'video' && <select value={cameraId} onChange={(event) => changeCamera(event.target.value)} disabled={busy || status === 'stopped'}><option value="">Cámara predeterminada</option>{devices.cameras.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{deviceLabel(device, 'Cámara', index)}</option>)}</select>}
                    <select value={microphoneId} onChange={(event) => changeMicrophone(event.target.value)} disabled={busy || status === 'stopped'}><option value="">Micrófono predeterminado</option>{devices.microphones.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{deviceLabel(device, 'Micrófono', index)}</option>)}</select>
                  </div>
                  <div className={`status-pill status-${status}`}><span className="status-dot" />{statusText}</div>
                </div>

                <div className={`studio-stage ${mode === 'audio' ? 'audio' : ''}`}>
                  {mode === 'video' ? (
                    recordingUrl && status === 'stopped'
                      ? <video src={recordingUrl} controls playsInline />
                      : <video className="live-video" ref={liveVideoRef} muted autoPlay playsInline />
                  ) : recordingUrl && status === 'stopped'
                    ? <div className="audio-review"><strong>AUDIO</strong><audio src={recordingUrl} controls /></div>
                    : <div className="audio-review"><strong>MIC</strong><span>Micrófono preparado</span></div>}
                  {(status === 'recording' || status === 'paused') && <div className="rec-overlay"><span />{status === 'paused' ? 'PAUSA' : 'REC'}</div>}
                  {status === 'detecting' && <div className="stage-message">Detectando cámara y micrófono…</div>}
                </div>

                <div className="record-footer">
                  <div className="meter-inline"><span>MIC</span><div><i style={{ width: `${Math.max(streamRef.current ? 2 : 0, micLevel)}%` }} /></div><strong>{micLevel}%</strong></div>
                  <div className="record-time">{formatTime(elapsedMs)}</div>
                  <div className="record-actions">
                    {status === 'detecting' && <button className="secondary-button" disabled>Detectando…</button>}
                    {status === 'idle' && <button className="secondary-button" onClick={() => openStream()}>Reintentar</button>}
                    {status === 'ready' && <button className="record-button" onClick={startRecording}><span />Grabar</button>}
                    {status === 'recording' && <><button className="secondary-button" onClick={pauseRecording}>Pausar</button><button className="danger-button" onClick={stopRecording}>Finalizar</button></>}
                    {status === 'paused' && <><button className="primary-button small" onClick={resumeRecording}>Continuar</button><button className="danger-button" onClick={stopRecording}>Finalizar</button></>}
                    {status === 'saving' && <button className="secondary-button" disabled>Guardando…</button>}
                    {status === 'stopped' && !currentTake?.accepted && <><button className="secondary-button" onClick={repeatCurrentSlide}>Repetir</button><button className="accept-button" onClick={acceptCurrentTake}>Aceptar</button></>}
                    {status === 'stopped' && currentTake?.accepted && <><button className="secondary-button" onClick={repeatCurrentSlide}>Regrabar</button><button className="primary-button small" onClick={() => goToSlide(Math.min(currentSlideIndex + 1, project.slides.length - 1))}>Siguiente</button></>}
                  </div>
                </div>

                {status === 'stopped' && recordingBlob && (
                  <div className="take-strip">
                    <div><span>Original</span><strong>{formatBytes(recordingBlob.size)}</strong></div>
                    <div><span>Optimizado</span><strong>{formatBytes(optimizedBlob?.size)}</strong></div>
                    <button onClick={optimizeRecording} disabled={isOptimizing}>{isOptimizing ? `${Math.round(optimizationProgress * 100)}%` : mode === 'video' ? 'Optimizar Full HD' : 'Optimizar audio'}</button>
                    <button onClick={() => downloadBlob(recordingBlob, timestampFilename(`diapositiva-${currentSlide.number}-original`, originalExtension))}>Descargar original</button>
                    <button onClick={() => downloadBlob(optimizedBlob, timestampFilename(`diapositiva-${currentSlide.number}-optimizada`, optimizedExtension))} disabled={!optimizedBlob}>Descargar optimizado</button>
                  </div>
                )}
              </div>

              <aside className="prompter-card">
                <div className="prompter-heading"><div><span className="eyebrow">PROMPTER</span><strong>Texto literal</strong></div><div className="prompter-controls"><button onClick={() => setPrompterFontSize((size) => Math.max(16, size - 2))}>A−</button><button onClick={() => setPrompterFontSize((size) => Math.min(44, size + 2))}>A+</button></div></div>
                <div className="speed-row"><span>Velocidad</span><input type="range" min="10" max="90" value={prompterSpeed} onChange={(event) => setPrompterSpeed(Number(event.target.value))} /><strong>{prompterSpeed}</strong></div>
                <div className="prompter-text" ref={prompterRef} style={{ fontSize: `${prompterFontSize}px` }}>
                  <h3>CUERPO</h3><pre>{currentSlide.body}</pre>
                  <h3>CONTENIDO</h3><pre>{currentSlide.content}</pre>
                  <div className="prompter-end">FIN DE DIAPOSITIVA</div>
                </div>
                <div className="prompter-footer"><button className="secondary-button" onClick={resetPrompter}>↥ Inicio</button><button className="primary-button small" onClick={() => setPrompterRunning((running) => !running)}>{prompterRunning ? 'Pausar' : '▶ Iniciar'}</button></div>
              </aside>
            </div>

            {recoveryMeta && <div className="recovery-banner"><span>Se encontró una toma interrumpida de la diapositiva {recoveryMeta.slideNumber}.</span><button onClick={recoverRecording}>Recuperar</button></div>}
          </section>
        )}

        {view === 'project' && project && (
          <section className="project-screen">
            <div className="screen-heading"><div><span className="eyebrow">PROYECTO LOCAL</span><h1>{project.name}</h1><p>{project.slides.length} diapositivas · {acceptedCount} aceptadas · {reviewCount} por revisar</p></div><button className="primary-button small" onClick={() => navigate('recording')}>Continuar grabando</button></div>
            <div className="project-list">
              {project.slides.map((slide, index) => {
                const state = slideState(takes[slide.number]);
                return <button className={`project-row ${state}`} key={slide.number} onClick={() => goToSlide(index)}><span className="slide-number">{String(slide.number).padStart(2, '0')}</span><div><strong>{slide.title}</strong><small>{state === 'accepted' ? 'Aceptada' : state === 'review' ? 'Grabada · falta aceptar' : 'Pendiente'}</small></div><span className="row-state">{state === 'accepted' ? '✓' : state === 'review' ? '◐' : '○'}</span></button>;
              })}
            </div>
          </section>
        )}

        {view === 'result' && project && (
          <section className="result-screen">
            <div className="screen-heading"><div><span className="eyebrow">RESULTADO</span><h1>Video final</h1><p>Primero deben quedar aceptadas todas las diapositivas.</p></div></div>
            <div className="result-summary"><div><strong>{acceptedCount}</strong><span>Aceptadas</span></div><div><strong>{project.slides.length - acceptedCount}</strong><span>Pendientes</span></div><div><strong>{project.slides.length}</strong><span>Total</span></div></div>
            <div className="result-progress"><div style={{ width: `${(acceptedCount / project.slides.length) * 100}%` }} /></div>
            {acceptedCount === project.slides.length ? <div className="result-ready"><strong>Todas las diapositivas están listas.</strong><span>La siguiente fase será definir exactamente cómo quieres unir y producir el video final.</span></div> : <div className="result-ready"><strong>Faltan {project.slides.length - acceptedCount} diapositivas.</strong><span>Completa las tomas pendientes antes de la unión final.</span><button className="primary-button small" onClick={() => navigate('project')}>Ver pendientes</button></div>}
          </section>
        )}
      </main>

      {(error || notice) && <div className={`studio-toast ${error ? 'error' : 'success'}`}><span>{error || notice}</span><button onClick={() => error ? setError('') : setNotice('')}>×</button></div>}
    </div>
  );
}
