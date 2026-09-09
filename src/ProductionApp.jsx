import { useEffect, useMemo, useRef, useState } from 'react';
import { cutMedia } from './ffmpeg';
import { AI_FORMAT_RULES, parseSlides } from './parser';
import {
  clearRecordingData,
  deleteSlideTake,
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
const LIBRARY_CATEGORIES = [
  ['intros', 'Intros'],
  ['transitions', 'Transiciones'],
  ['endings', 'Endings'],
  ['cta', 'Llamados a la acción'],
  ['memes', 'Video memes'],
];
const NAV_ITEMS = [
  ['content', 'Contenido'],
  ['recording', 'Grabación'],
  ['cut', 'Corte'],
  ['library', 'Biblioteca'],
  ['join', 'Unión'],
  ['memes', 'Video memes'],
  ['result', 'Resultado'],
];
const INHERIT = '__inherit__';
const NONE = '__none__';

function chooseMimeType(mode) {
  const candidates = mode === 'video' ? VIDEO_MIME_TYPES : AUDIO_MIME_TYPES;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function formatTime(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatBytes(bytes = 0) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : value >= 100 ? 0 : 1)} ${units[index]}`;
}

function useBlobUrl(blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) {
      setUrl('');
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function normalizeChoice(value) {
  if (value === NONE || value === INHERIT) return value;
  return value || INHERIT;
}

function resolveChoice(value, fallback = '') {
  if (value === NONE) return '';
  if (!value || value === INHERIT) return fallback || '';
  return value;
}

function normalizeProject(project) {
  if (!project) return null;
  const rawPlan = project.productionPlan || {};
  return {
    ...project,
    slides: (project.slides || []).map((slide) => ({
      hook: '',
      reading: '',
      visual: '',
      cta: '',
      ...slide,
    })),
    productionPlan: {
      theme: rawPlan.theme || 'blue',
      intro: normalizeChoice(rawPlan.intro),
      ending: normalizeChoice(rawPlan.ending),
      transitionDefault: normalizeChoice(rawPlan.transitionDefault),
      transitions: rawPlan.transitions || {},
      ctaAssets: rawPlan.ctaAssets || {},
      scenes: rawPlan.scenes || {},
      memes: rawPlan.memes || [],
    },
  };
}

function rowsToMap(rows = []) {
  return Object.fromEntries(rows.map((take) => [take.slideNumber, take]));
}

function fileName(filePath = '') {
  return String(filePath).split(/[\\/]/).pop() || 'Sin seleccionar';
}

function downloadText(text, filename) {
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

function isActiveCta(cta = '') {
  const normalized = String(cta).toUpperCase();
  return !!normalized && !/TIPO\s*:\s*NINGUNO/.test(normalized) && normalized.trim() !== 'NINGUNO';
}

function sameSceneContent(a, b) {
  if (!a || !b) return false;
  return ['title', 'body', 'content', 'visual', 'cta'].every((key) => String(a[key] || '') === String(b[key] || ''));
}

function mergeRanges(ranges = [], start = 0, end = Infinity) {
  const sorted = ranges
    .map((range) => ({ start: Math.max(start, Number(range.start) || 0), end: Math.min(end, Number(range.end) || 0) }))
    .filter((range) => range.end - range.start >= 0.03)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 0.01) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function cleanedDurationSeconds(start, end, removedRanges) {
  const removed = mergeRanges(removedRanges, start, end).reduce((sum, range) => sum + (range.end - range.start), 0);
  return Math.max(0, end - start - removed);
}

export default function ProductionApp() {
  const [view, setView] = useState('content');
  const [project, setProject] = useState(null);
  const [takes, setTakes] = useState({});
  const [rawText, setRawText] = useState('');
  const [parseResult, setParseResult] = useState(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const [mode, setMode] = useState('video');
  const [status, setStatus] = useState('idle');
  const [devices, setDevices] = useState({ cameras: [], microphones: [] });
  const [cameraId, setCameraId] = useState('');
  const [microphoneId, setMicrophoneId] = useState('');
  const [resolution, setResolution] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [prompterFontSize, setPrompterFontSize] = useState(25);
  const [prompterSpeed, setPrompterSpeed] = useState(34);
  const [prompterRunning, setPrompterRunning] = useState(false);
  const [retaking, setRetaking] = useState(false);
  const [recoveryMeta, setRecoveryMeta] = useState(null);

  const [cutSlideIndex, setCutSlideIndex] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [removedRanges, setRemovedRanges] = useState([]);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [cutting, setCutting] = useState(false);
  const [cutProgress, setCutProgress] = useState(0);

  const [libraryScope, setLibraryScope] = useState('global');
  const [libraryCategory, setLibraryCategory] = useState('intros');
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryDefaults, setLibraryDefaults] = useState({});
  const [resourcePool, setResourcePool] = useState({});

  const [joinSlideIndex, setJoinSlideIndex] = useState(0);
  const [memeSlideIndex, setMemeSlideIndex] = useState(0);
  const [memeAsset, setMemeAsset] = useState('');
  const [memeAt, setMemeAt] = useState(2);
  const [memeBlur, setMemeBlur] = useState(10);
  const [memeSize, setMemeSize] = useState('medium');

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
  const prompterRef = useRef(null);
  const mountedRef = useRef(true);

  const currentSlide = project?.slides?.[currentSlideIndex] || null;
  const currentTake = currentSlide ? takes[currentSlide.number] : null;
  const recordingUrl = useBlobUrl(recordingBlob);

  const cutSlide = project?.slides?.[cutSlideIndex] || null;
  const cutTake = cutSlide ? takes[cutSlide.number] : null;
  const cutBlob = cutTake?.cleanedBlob || cutTake?.blob || null;
  const cutUrl = useBlobUrl(cutBlob);

  const joinSlide = project?.slides?.[joinSlideIndex] || null;
  const joinTake = joinSlide ? takes[joinSlide.number] : null;
  const joinBlob = joinTake?.cleanedBlob || joinTake?.blob || null;
  const joinVideoUrl = useBlobUrl(joinBlob);

  const acceptedCount = useMemo(
    () => (project?.slides || []).filter((slide) => takes[slide.number]?.accepted).length,
    [project, takes],
  );
  const cleanedCount = useMemo(
    () => (project?.slides || []).filter((slide) => takes[slide.number]?.cleanedBlob).length,
    [project, takes],
  );
  const mountedCount = useMemo(
    () => (project?.slides || []).filter((slide) => project?.productionPlan?.scenes?.[slide.number]?.ready).length,
    [project],
  );

  const busyRecording = ['detecting', 'recording', 'paused', 'saving'].includes(status);

  function cleanupAudioMeter() {
    if (meterFrameRef.current) cancelAnimationFrame(meterFrameRef.current);
    meterFrameRef.current = null;
    if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    audioContextRef.current = null;
    if (mountedRef.current) setMicLevel(0);
  }

  function stopMediaStream() {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
    cleanupAudioMeter();
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
    audioContextRef.current = context;
    const samples = new Uint8Array(analyser.fftSize);

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

  async function refreshDevices(stream = streamRef.current) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    if (!mountedRef.current) return;
    const cameras = list.filter((item) => item.kind === 'videoinput');
    const microphones = list.filter((item) => item.kind === 'audioinput');
    setDevices({ cameras, microphones });
    const videoId = stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId || '';
    const audioId = stream?.getAudioTracks?.()[0]?.getSettings?.().deviceId || '';
    if (videoId) setCameraId(videoId);
    if (audioId) setMicrophoneId(audioId);
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
      frameRate: { ideal: 30, max: 30 },
      aspectRatio: { ideal: 16 / 9 },
      ...(exact && targetCameraId ? { deviceId: { exact: targetCameraId } } : {}),
    };
    return { audio, video: targetMode === 'video' ? video : false };
  }

  async function openStream(overrides = {}) {
    setError('');
    const targetMode = overrides.mode ?? mode;
    const targetCameraId = overrides.cameraId ?? cameraId;
    const targetMicrophoneId = overrides.microphoneId ?? microphoneId;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('No se puede acceder a cámara y micrófono.');
      setStatus('idle');
      return null;
    }

    setStatus('detecting');
    stopMediaStream();
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          buildConstraints(targetMode, targetCameraId, targetMicrophoneId, true),
        );
      } catch (caught) {
        if (!['OverconstrainedError', 'NotFoundError', 'DevicesNotFoundError'].includes(caught?.name)) throw caught;
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
      setStatus('ready');
      return stream;
    } catch (caught) {
      console.error(caught);
      setStatus('idle');
      setError('No se pudo abrir la cámara o el micrófono. Revisa permisos y dispositivos.');
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
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) setPrompterRunning(false);
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
    const timer = setInterval(updateElapsed, 200);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    mountedRef.current = true;
    const initialise = async () => {
      try {
        const active = normalizeProject(await getActiveProject());
        const meta = await getRecordingMeta();
        const chunks = meta ? await getChunks() : [];
        if (meta && chunks.length && meta.projectId && meta.slideNumber) setRecoveryMeta(meta);
        else if (chunks.length) await clearRecordingData();

        if (active) {
          const rows = await getProjectTakes(active.id);
          const mapped = rowsToMap(rows);
          setProject(active);
          setRawText(active.rawText || '');
          setTakes(mapped);
          const pending = active.slides.findIndex((slide) => !mapped[slide.number]?.accepted);
          setCurrentSlideIndex(pending >= 0 ? pending : 0);
          setView('recording');
        } else {
          await refreshDevices(null).catch(() => {});
        }
      } catch (caught) {
        console.error(caught);
        setError('No se pudo recuperar el proyecto local.');
      }
    };
    initialise();
    const deviceChange = () => refreshDevices(streamRef.current).catch(() => {});
    navigator.mediaDevices?.addEventListener?.('devicechange', deviceChange);
    return () => {
      mountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', deviceChange);
      stopMediaStream();
    };
  }, []);

  useEffect(() => {
    if (view !== 'recording' || !project || !currentSlide) {
      stopMediaStream();
      return;
    }
    setRetaking(false);
    resetPrompter();
    const take = takes[currentSlide.number];
    if (take?.blob) {
      stopMediaStream();
      setRecordingBlob(take.blob);
      setMode(take.mode || 'video');
      elapsedRef.current = take.durationMs || 0;
      setElapsedMs(elapsedRef.current);
      if (take.width && take.height) setResolution({ width: take.width, height: take.height, frameRate: take.frameRate || 0 });
      setStatus('stopped');
      return;
    }
    setRecordingBlob(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
    openStream({ mode, cameraId, microphoneId });
  }, [view, project?.id, currentSlideIndex]);

  useEffect(() => {
    if (!cutTake) {
      setRemovedRanges([]);
      return;
    }
    const duration = Math.max(0.1, (cutTake.durationMs || 0) / 1000);
    const start = Number(cutTake.trimStart || 0);
    const end = Number(cutTake.trimEnd || duration);
    setTrimStart(start);
    setTrimEnd(end);
    setRemovedRanges(cutTake.removedRanges || []);
    setRangeStart(start);
    setRangeEnd(Math.min(end, start + 1));
  }, [cutSlideIndex, cutTake?.updatedAt]);

  async function copyAiRules() {
    try {
      await navigator.clipboard.writeText(AI_FORMAT_RULES);
      setNotice('Reglas copiadas.');
    } catch {
      setError('No se pudieron copiar las reglas. Usa Descargar reglas.');
    }
  }

  function parseContent() {
    const result = parseSlides(rawText);
    setParseResult(result);
    setError(result.errors[0] || '');
  }

  async function loadContentFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    const result = parseSlides(text);
    setParseResult(result);
    setError(result.errors[0] || '');
    event.target.value = '';
  }

  async function saveContentProject() {
    const result = parseSlides(rawText);
    setParseResult(result);
    if (result.errors.length || !result.slides.length) {
      setError(result.errors[0] || 'No hay diapositivas válidas.');
      return;
    }

    let nextTakes = { ...takes };
    let plan = normalizeProject(project || { slides: [], productionPlan: {} })?.productionPlan || normalizeProject({ slides: [], productionPlan: {} }).productionPlan;

    if (project) {
      const oldSlides = Object.fromEntries(project.slides.map((slide) => [slide.number, slide]));
      const newSlides = Object.fromEntries(result.slides.map((slide) => [slide.number, slide]));
      const scenes = { ...(plan.scenes || {}) };
      const transitions = { ...(plan.transitions || {}) };
      const ctaAssets = { ...(plan.ctaAssets || {}) };
      let memes = [...(plan.memes || [])];

      for (const [key, take] of Object.entries(takes)) {
        const number = Number(key);
        const oldSlide = oldSlides[number];
        const newSlide = newSlides[number];
        if (!newSlide) {
          await deleteSlideTake(project.id, number);
          delete nextTakes[number];
          delete scenes[number];
          delete transitions[number];
          delete ctaAssets[number];
          memes = memes.filter((item) => item.slideNumber !== number);
          continue;
        }

        if (oldSlide && String(oldSlide.reading || '') !== String(newSlide.reading || '')) {
          const stale = {
            ...take,
            accepted: false,
            cleanedBlob: null,
            trimStart: 0,
            trimEnd: null,
            removedRanges: [],
            cleanedAt: null,
            cleanedDurationMs: null,
          };
          await saveSlideTake(project.id, number, stale);
          nextTakes[number] = stale;
          delete scenes[number];
          memes = memes.filter((item) => item.slideNumber !== number);
        } else if (!sameSceneContent(oldSlide, newSlide)) {
          delete scenes[number];
        }
      }

      plan = { ...plan, scenes, transitions, ctaAssets, memes };
    }

    const next = normalizeProject({
      ...(project || {}),
      id: project?.id || `project-${Date.now()}`,
      name: result.slides[0]?.title || project?.name || 'Proyecto de video',
      rawText,
      slides: result.slides,
      productionPlan: plan,
      createdAt: project?.createdAt || Date.now(),
      updatedAt: Date.now(),
    });

    await saveProject(next);
    setProject(next);
    setTakes(project ? nextTakes : {});
    const firstPending = result.slides.findIndex((slide) => !nextTakes[slide.number]?.accepted);
    setCurrentSlideIndex(firstPending >= 0 ? firstPending : 0);
    setParseResult(null);
    setView('recording');
    setNotice(project ? 'Contenido actualizado. Las tomas afectadas quedaron marcadas para revisión.' : 'Proyecto creado.');
    setError('');
  }

  async function startRecording() {
    if (!project || !currentSlide?.reading?.trim()) {
      setError(`La diapositiva ${currentSlide?.number || ''} no tiene LECTURA.`);
      return;
    }
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
      const sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
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
        setError('La grabación encontró un error. Finaliza la toma para conservar lo disponible.');
      };
      recorder.onstop = async () => {
        try {
          const writes = await Promise.allSettled(pendingWritesRef.current);
          if (writes.some((item) => item.status === 'rejected')) throw new Error('No se guardaron todos los fragmentos.');
          const rows = await getChunks();
          if (!rows.length) throw new Error('La toma no produjo datos.');
          const blob = new Blob(rows.map((row) => row.blob), { type: recorder.mimeType || mimeType || rows[0].blob.type });
          const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
          const take = {
            blob,
            cleanedBlob: null,
            accepted: false,
            mode,
            mimeType: blob.type,
            durationMs: elapsedRef.current,
            width: settings.width || 0,
            height: settings.height || 0,
            frameRate: settings.frameRate || 0,
            removedRanges: [],
            createdAt: Date.now(),
          };
          await saveSlideTake(projectId, slideNumber, take);
          await clearRecordingData();
          setTakes((old) => ({ ...old, [slideNumber]: take }));
          setRecordingBlob(blob);
          setStatus('stopped');
          setRetaking(false);
          setRecoveryMeta(null);
          setNotice(`Toma ${slideNumber} lista para revisar.`);
        } catch (caught) {
          console.error(caught);
          setError(caught.message || 'No se pudo guardar la toma.');
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
      await setRecordingMeta({ sessionId, projectId, slideNumber, mode, mimeType: recorder.mimeType || mimeType, createdAt: Date.now() });
      recorder.start(1000);
      setStatus('recording');
    } catch (caught) {
      console.error(caught);
      setError('No se pudo iniciar la grabación.');
    }
  }

  function pauseRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state !== 'recording') return;
    recorder.pause();
    pausedStartedAtRef.current = Date.now();
    setPrompterRunning(false);
    setStatus('paused');
  }

  function resumeRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state !== 'paused') return;
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

  async function acceptTake() {
    if (!project || !currentSlide || !recordingBlob) return;
    const previous = takes[currentSlide.number] || {};
    const nextTake = { ...previous, blob: recordingBlob, accepted: true, durationMs: elapsedRef.current };
    await saveSlideTake(project.id, currentSlide.number, nextTake);
    const nextMap = { ...takes, [currentSlide.number]: nextTake };
    setTakes(nextMap);
    setNotice(`Diapositiva ${currentSlide.number} aceptada.`);

    const pending = project.slides.findIndex((slide) => !nextMap[slide.number]?.accepted);
    if (pending >= 0) setCurrentSlideIndex(pending);
    else {
      const firstUnclean = project.slides.findIndex((slide) => !nextMap[slide.number]?.cleanedBlob);
      setCutSlideIndex(firstUnclean >= 0 ? firstUnclean : 0);
      setView('cut');
    }
  }

  async function repeatTake() {
    setRecordingBlob(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
    resetPrompter();
    setRetaking(true);
    await openStream({ mode, cameraId, microphoneId });
    setNotice('La nueva toma reemplazará la anterior cuando finalices.');
  }

  async function recoverInterruptedRecording() {
    try {
      const meta = await getRecordingMeta();
      const rows = await getChunks();
      if (!meta || !rows.length || !meta.projectId || !meta.slideNumber) throw new Error('No hay una toma recuperable.');
      const blob = new Blob(rows.map((row) => row.blob), { type: meta.mimeType || rows[0].blob.type });
      const take = {
        blob,
        cleanedBlob: null,
        accepted: false,
        mode: meta.mode || 'video',
        mimeType: blob.type,
        durationMs: rows.length * 1000,
        removedRanges: [],
        createdAt: meta.createdAt || Date.now(),
      };
      await saveSlideTake(meta.projectId, meta.slideNumber, take);
      await clearRecordingData();
      if (project?.id === meta.projectId) {
        const index = project.slides.findIndex((slide) => slide.number === meta.slideNumber);
        setTakes((old) => ({ ...old, [meta.slideNumber]: take }));
        if (index >= 0) setCurrentSlideIndex(index);
        setMode(take.mode);
        setRecordingBlob(blob);
        elapsedRef.current = take.durationMs;
        setElapsedMs(take.durationMs);
        setStatus('stopped');
        setView('recording');
      }
      setRecoveryMeta(null);
      setNotice(`Se recuperó la toma de la diapositiva ${meta.slideNumber}.`);
    } catch (caught) {
      setError(caught.message || 'No se pudo recuperar la grabación.');
    }
  }

  function addInternalCut() {
    const start = Number(rangeStart);
    const end = Number(rangeEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.03) {
      setError('El corte interno necesita un inicio y un final válidos.');
      return;
    }
    if (start < trimStart || end > trimEnd) {
      setError('El corte interno debe estar dentro del inicio y final seleccionados.');
      return;
    }
    setRemovedRanges((old) => mergeRanges([...old, { start, end }], trimStart, trimEnd));
    setError('');
  }

  async function applyCut() {
    if (!project || !cutSlide || !cutTake?.blob || cutting) return;
    const fullDuration = Math.max(0.1, (cutTake.durationMs || 0) / 1000);
    const start = Math.max(0, Number(trimStart) || 0);
    const end = Math.min(fullDuration, Math.max(start + 0.05, Number(trimEnd) || fullDuration));
    const ranges = mergeRanges(removedRanges, start, end);
    const outputDuration = cleanedDurationSeconds(start, end, ranges);
    if (outputDuration < 0.05) {
      setError('Los cortes eliminarían toda la grabación.');
      return;
    }

    setCutting(true);
    setCutProgress(0);
    setError('');
    try {
      const unchanged = start <= 0.01 && Math.abs(end - fullDuration) <= 0.05 && !ranges.length;
      const cleanedBlob = unchanged
        ? cutTake.blob
        : await cutMedia(cutTake.blob, cutTake.mode || 'video', start, end, ranges, setCutProgress);
      const nextTake = {
        ...cutTake,
        cleanedBlob,
        trimStart: start,
        trimEnd: end,
        removedRanges: ranges,
        cleanedAt: Date.now(),
        cleanedDurationMs: Math.round(outputDuration * 1000),
      };
      await saveSlideTake(project.id, cutSlide.number, nextTake);
      const nextMap = { ...takes, [cutSlide.number]: nextTake };
      setTakes(nextMap);
      setNotice(`Diapositiva ${cutSlide.number} limpia y guardada.`);
      const nextPending = project.slides.findIndex((slide, index) => index > cutSlideIndex && nextMap[slide.number]?.accepted && !nextMap[slide.number]?.cleanedBlob);
      if (nextPending >= 0) setCutSlideIndex(nextPending);
    } catch (caught) {
      console.error(caught);
      setError(caught.message || 'No se pudo aplicar el corte. El original permanece intacto.');
    } finally {
      setCutting(false);
    }
  }

  async function saveProjectPlan(patch) {
    if (!project) return null;
    const next = normalizeProject({
      ...project,
      productionPlan: { ...project.productionPlan, ...patch },
      updatedAt: Date.now(),
    });
    await saveProject(next);
    setProject(next);
    return next;
  }

  async function loadLibrary() {
    const api = window.videosStudio?.library;
    if (!api) {
      setError('La Biblioteca necesita ejecutarse desde Electron.');
      return;
    }
    try {
      const items = await api.listMedia({
        scope: libraryScope,
        projectId: libraryScope === 'project' ? project?.id : '',
        category: libraryCategory,
      });
      setLibraryItems(items || []);
      setLibraryDefaults(await api.getDefaults());
    } catch (caught) {
      console.error(caught);
      setError(caught.message || 'No se pudo leer la biblioteca local.');
    }
  }

  async function importLibraryMedia() {
    const api = window.videosStudio?.library;
    if (!api) return setError('La Biblioteca necesita Electron.');
    if (libraryScope === 'project' && !project) return setError('Primero crea un proyecto.');
    try {
      await api.importMedia({
        scope: libraryScope,
        projectId: libraryScope === 'project' ? project?.id : '',
        category: libraryCategory,
      });
      await loadLibrary();
    } catch (caught) {
      setError(caught.message || 'No se pudo agregar el video a la biblioteca.');
    }
  }

  async function removeLibraryMedia(item) {
    const api = window.videosStudio?.library;
    if (!api) return;
    try {
      await api.deleteMedia({ scope: item.scope, projectId: item.projectId, category: item.category, path: item.path });
      await loadLibrary();
      setNotice(`${item.name} eliminado de la biblioteca.`);
    } catch (caught) {
      setError(caught.message || 'No se pudo eliminar el recurso.');
    }
  }

  async function setLibraryDefault(item) {
    const api = window.videosStudio?.library;
    if (!api || item.scope !== 'global') return;
    try {
      const defaults = await api.setDefault({ category: item.category, path: item.path });
      setLibraryDefaults(defaults || {});
      setNotice(`${item.name} quedó como predeterminado para ${item.category}.`);
    } catch (caught) {
      setError(caught.message || 'No se pudo establecer el predeterminado.');
    }
  }

  async function refreshResourcePool() {
    const api = window.videosStudio?.library;
    if (!api) return;
    try {
      const next = {};
      for (const [category] of LIBRARY_CATEGORIES) {
        const globalItems = await api.listMedia({ scope: 'global', category });
        const projectItems = project ? await api.listMedia({ scope: 'project', projectId: project.id, category }) : [];
        next[category] = [...(projectItems || []), ...(globalItems || [])];
      }
      setResourcePool(next);
      setLibraryDefaults(await api.getDefaults());
    } catch (caught) {
      console.error(caught);
      setError('No se pudieron cargar los recursos de montaje.');
    }
  }

  useEffect(() => {
    if (view === 'library') loadLibrary();
  }, [view, libraryScope, libraryCategory, project?.id]);

  useEffect(() => {
    if (view === 'join' || view === 'memes' || view === 'result') refreshResourcePool();
  }, [view, project?.id]);

  function navigate(nextView) {
    if (['recording', 'paused', 'saving'].includes(status)) {
      setError('Finaliza la grabación antes de cambiar de pantalla.');
      return;
    }
    setError('');
    setView(nextView);
  }

  function invalidateScene(scenes, slideNumber) {
    const next = { ...(scenes || {}) };
    if (next[slideNumber]) next[slideNumber] = { ...next[slideNumber], ready: false };
    return next;
  }

  async function updateSceneTransition(value) {
    if (!joinSlide) return;
    const transitions = { ...(project.productionPlan.transitions || {}), [joinSlide.number]: value };
    const scenes = invalidateScene(project.productionPlan.scenes, joinSlide.number);
    await saveProjectPlan({ transitions, scenes });
  }

  async function updateSceneCta(value) {
    if (!joinSlide) return;
    const ctaAssets = { ...(project.productionPlan.ctaAssets || {}), [joinSlide.number]: value };
    const scenes = invalidateScene(project.productionPlan.scenes, joinSlide.number);
    await saveProjectPlan({ ctaAssets, scenes });
  }

  async function markSceneReady() {
    if (!project || !joinSlide) return;
    if (!joinTake?.cleanedBlob) return setError('Primero guarda el corte limpio de esta diapositiva.');
    if (!joinSlide.visual?.trim()) return setError('Esta diapositiva no tiene VISUAL definido.');

    const ctaAsset = resolveChoice(project.productionPlan.ctaAssets?.[joinSlide.number], libraryDefaults.cta || '');
    if (isActiveCta(joinSlide.cta) && !ctaAsset) return setError('Esta diapositiva tiene CTA. Selecciona un video CTA antes de marcarla como lista.');

    const transition = resolveChoice(
      project.productionPlan.transitions?.[joinSlide.number],
      resolveChoice(project.productionPlan.transitionDefault, libraryDefaults.transitions || ''),
    );
    const scenes = {
      ...(project.productionPlan.scenes || {}),
      [joinSlide.number]: {
        ready: true,
        visual: joinSlide.visual || '',
        transition,
        ctaAsset,
        updatedAt: Date.now(),
      },
    };
    await saveProjectPlan({ scenes });
    setNotice(`Montaje de la diapositiva ${joinSlide.number} marcado como listo.`);
    if (joinSlideIndex < project.slides.length - 1) setJoinSlideIndex((value) => value + 1);
  }

  async function addMemeEvent() {
    const slide = project?.slides?.[memeSlideIndex];
    const take = slide ? takes[slide.number] : null;
    if (!slide || !memeAsset) return setError('Selecciona una diapositiva y un video meme.');
    if (!take?.cleanedBlob) return setError('Primero guarda el corte limpio de esa diapositiva.');
    const duration = Math.max(0, (take.cleanedDurationMs || take.durationMs || 0) / 1000);
    const atSeconds = Math.max(0, Number(memeAt) || 0);
    if (duration && atSeconds >= duration) return setError(`El meme debe aparecer antes de ${duration.toFixed(1)} s.`);

    const event = {
      id: `meme-${Date.now()}`,
      slideNumber: slide.number,
      assetPath: memeAsset,
      atSeconds,
      blur: Number(memeBlur) || 0,
      size: memeSize,
    };
    await saveProjectPlan({ memes: [...(project.productionPlan.memes || []), event] });
    setNotice('Video meme programado. El video principal se pausará y desenfocará durante el meme.');
  }

  async function removeMemeEvent(id) {
    await saveProjectPlan({ memes: (project.productionPlan.memes || []).filter((item) => item.id !== id) });
  }

  const statusLabel = {
    detecting: 'Detectando',
    idle: 'Sin dispositivo',
    ready: 'Listo',
    recording: 'Grabando',
    paused: 'Pausado',
    saving: 'Guardando',
    stopped: currentTake?.accepted ? 'Aceptada' : 'Revisar toma',
  }[status] || 'Listo';

  const currentSlideWindow = useMemo(() => {
    if (!project) return [];
    const start = Math.max(0, Math.min(currentSlideIndex - 3, Math.max(0, project.slides.length - 7)));
    return project.slides.slice(start, start + 7);
  }, [project, currentSlideIndex]);

  const defaults = project?.productionPlan || {};
  const resolvedIntro = resolveChoice(defaults.intro, libraryDefaults.intros || '');
  const resolvedEnding = resolveChoice(defaults.ending, libraryDefaults.endings || '');
  const defaultTransitionPath = resolveChoice(defaults.transitionDefault, libraryDefaults.transitions || '');
  const memeOptions = resourcePool.memes || [];

  const resourcePathSets = useMemo(() => {
    const sets = {};
    for (const [category] of LIBRARY_CATEGORIES) sets[category] = new Set((resourcePool[category] || []).map((item) => item.path));
    return sets;
  }, [resourcePool]);

  const missingCtaCount = useMemo(() => {
    if (!project) return 0;
    return project.slides.filter((slide) => {
      if (!isActiveCta(slide.cta)) return false;
      return !resolveChoice(project.productionPlan.ctaAssets?.[slide.number], libraryDefaults.cta || '');
    }).length;
  }, [project, libraryDefaults.cta]);

  const visualMissingCount = useMemo(
    () => (project?.slides || []).filter((slide) => !slide.visual?.trim()).length,
    [project],
  );

  const invalidMemeCount = useMemo(() => {
    if (!project) return 0;
    return (project.productionPlan.memes || []).filter((item) => {
      const take = takes[item.slideNumber];
      const duration = (take?.cleanedDurationMs || take?.durationMs || 0) / 1000;
      return !take?.cleanedBlob || item.atSeconds < 0 || (duration > 0 && item.atSeconds >= duration);
    }).length;
  }, [project, takes]);

  const missingAssetCount = useMemo(() => {
    if (!project) return 0;
    const missing = new Set();
    const check = (path, category) => {
      if (path && !resourcePathSets[category]?.has(path)) missing.add(`${category}:${path}`);
    };
    check(resolvedIntro, 'intros');
    check(resolvedEnding, 'endings');
    check(defaultTransitionPath, 'transitions');
    project.slides.forEach((slide) => {
      const transition = resolveChoice(project.productionPlan.transitions?.[slide.number], defaultTransitionPath);
      const cta = resolveChoice(project.productionPlan.ctaAssets?.[slide.number], libraryDefaults.cta || '');
      check(transition, 'transitions');
      if (isActiveCta(slide.cta)) check(cta, 'cta');
    });
    (project.productionPlan.memes || []).forEach((item) => check(item.assetPath, 'memes'));
    return missing.size;
  }, [project, resourcePathSets, resolvedIntro, resolvedEnding, defaultTransitionPath, libraryDefaults.cta]);

  const resultReady = !!project
    && acceptedCount === project.slides.length
    && cleanedCount === project.slides.length
    && mountedCount === project.slides.length
    && missingCtaCount === 0
    && visualMissingCount === 0
    && invalidMemeCount === 0
    && missingAssetCount === 0;

  return (
    <div className="production-app">
      <header className="production-header">
        <div className="production-brand"><strong>Videos Studio</strong><span>Producción local por escenas</span></div>
        <nav className="production-nav">
          {NAV_ITEMS.map(([key, label]) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => navigate(key)} disabled={!project && key !== 'content' && key !== 'library'}>{label}</button>
          ))}
        </nav>
        <div className="production-progress"><strong>{project ? `${acceptedCount}/${project.slides.length}` : 'Nuevo'}</strong><span>{project ? 'grabadas' : 'proyecto'}</span></div>
      </header>

      <main className="production-main">
        {view === 'content' && (
          <section className="flow-screen content-flow">
            <div className="flow-heading"><div><span className="eyebrow">1 · CONTENIDO</span><h1>Cargar estructura del video</h1><p>GANCHO + TÍTULO + CUERPO + CONTENIDO + LECTURA + VISUAL + CTA.</p></div><div className="heading-actions"><button className="secondary-button" onClick={copyAiRules}>Copiar reglas IA</button><button className="secondary-button" onClick={() => downloadText(AI_FORMAT_RULES, 'reglas-videos-studio.txt')}>Descargar reglas</button></div></div>
            <div className="content-production-grid">
              <div className="production-card source-card">
                <div className="card-title-row"><strong>Contenido fuente</strong><label className="file-button">Cargar TXT<input type="file" accept=".txt,text/plain" onChange={loadContentFile} /></label></div>
                <textarea value={rawText} onChange={(event) => { setRawText(event.target.value); setParseResult(null); }} placeholder={'DIAPOSITIVA 1\nGANCHO:\n...\n\nTÍTULO:\n...\n\nCUERPO:\n- ...\n\nCONTENIDO:\n- ...\n\nLECTURA:\n...\n\nVISUAL:\nTIPO: IMAGEN\nDESCRIPCIÓN: ...\n\nCTA:\nTIPO: NINGUNO\n\n//'} />
                <button className="primary-button" onClick={parseContent} disabled={!rawText.trim()}>Procesar diapositivas</button>
              </div>
              <div className="production-card validation-card">
                <div className="card-title-row"><strong>Validación</strong>{parseResult && <span className="count-badge">{parseResult.slides.length} detectadas</span>}</div>
                {!parseResult && <div className="empty-state">Procesa el contenido para revisar la estructura antes de grabar.</div>}
                {parseResult && <>
                  {!!parseResult.errors.length && <div className="validation error-box">{parseResult.errors.map((item) => <div key={item}>• {item}</div>)}</div>}
                  {!!parseResult.warnings.length && <div className="validation warning-box">{parseResult.warnings.slice(0, 10).map((item) => <div key={item}>• {item}</div>)}</div>}
                  <div className="production-slide-list">{parseResult.slides.map((slide) => <div className="production-slide-row" key={slide.number}><span>{String(slide.number).padStart(2, '0')}</span><div><strong>{slide.title || 'Sin título'}</strong><small>{slide.hook ? 'GANCHO ✓' : 'GANCHO —'} · {slide.reading ? 'LECTURA ✓' : 'LECTURA —'} · {slide.visual ? 'VISUAL ✓' : 'VISUAL —'} · {isActiveCta(slide.cta) ? 'CTA ✓' : 'CTA —'}</small></div></div>)}</div>
                  <button className="primary-button" onClick={saveContentProject} disabled={!!parseResult.errors.length}>{project ? 'Actualizar proyecto' : 'Crear proyecto y grabar'}</button>
                </>}
              </div>
            </div>
          </section>
        )}

        {view === 'recording' && project && currentSlide && (
          <section className="flow-screen recording-flow">
            <div className="slide-flow-header"><button onClick={() => setCurrentSlideIndex((value) => Math.max(0, value - 1))} disabled={busyRecording || currentSlideIndex === 0}>←</button><div><span>DIAPOSITIVA {currentSlide.number} DE {project.slides.length}</span><h1>{currentSlide.title}</h1></div><button onClick={() => setCurrentSlideIndex((value) => Math.min(project.slides.length - 1, value + 1))} disabled={busyRecording || currentSlideIndex === project.slides.length - 1}>→</button></div>
            <div className="slide-mini-rail">{currentSlideWindow.map((slide) => { const index = project.slides.findIndex((item) => item.number === slide.number); const take = takes[slide.number]; return <button key={slide.number} className={index === currentSlideIndex ? 'current' : ''} onClick={() => setCurrentSlideIndex(index)} disabled={busyRecording}><span>{slide.number}</span><small>{take?.accepted ? '✓' : take?.blob ? '◐' : '○'}</small></button>; })}</div>
            <div className="recording-production-grid">
              <div className="production-card camera-production-card">
                <div className="recording-topline"><div className="mode-switch"><button className={mode === 'video' ? 'active' : ''} onClick={() => { setMode('video'); openStream({ mode: 'video' }); }} disabled={busyRecording || (!!currentTake?.blob && !retaking)}>Video + audio</button><button className={mode === 'audio' ? 'active' : ''} onClick={() => { setMode('audio'); openStream({ mode: 'audio' }); }} disabled={busyRecording || (!!currentTake?.blob && !retaking)}>Solo audio</button></div><div className="device-selects">{mode === 'video' && <select value={cameraId} onChange={(event) => { setCameraId(event.target.value); openStream({ cameraId: event.target.value }); }} disabled={busyRecording || status === 'stopped'}><option value="">Cámara predeterminada</option>{devices.cameras.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Cámara ${index + 1}`}</option>)}</select>}<select value={microphoneId} onChange={(event) => { setMicrophoneId(event.target.value); openStream({ microphoneId: event.target.value }); }} disabled={busyRecording || status === 'stopped'}><option value="">Micrófono predeterminado</option>{devices.microphones.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Micrófono ${index + 1}`}</option>)}</select></div><span className={`status-pill status-${status}`}><i className="status-dot" />{statusLabel}</span></div>
                <div className="production-stage">{mode === 'video' ? (recordingUrl && status === 'stopped' ? <video src={recordingUrl} controls playsInline /> : <video ref={liveVideoRef} className="live-video" muted autoPlay playsInline />) : <div className="audio-stage">{recordingUrl && status === 'stopped' ? <audio src={recordingUrl} controls /> : 'Micrófono preparado'}</div>}{(status === 'recording' || status === 'paused') && <div className="rec-indicator">{status === 'paused' ? 'PAUSA' : 'REC'}</div>}</div>
                <div className="recording-bottom"><div className="mic-meter"><span>MIC</span><div><i style={{ width: `${Math.max(streamRef.current ? 2 : 0, micLevel)}%` }} /></div><strong>{micLevel}%</strong></div><div className="record-clock">{formatTime(elapsedMs)}</div><div className="record-actions">{status === 'ready' && <button className="record-button" onClick={startRecording} disabled={!currentSlide.reading?.trim()}>Grabar</button>}{status === 'detecting' && <button className="secondary-button" disabled>Detectando…</button>}{status === 'idle' && <button className="secondary-button" onClick={() => openStream()}>Reintentar</button>}{status === 'recording' && <><button className="secondary-button" onClick={pauseRecording}>Pausar</button><button className="danger-button" onClick={stopRecording}>Finalizar</button></>}{status === 'paused' && <><button className="primary-button small" onClick={resumeRecording}>Continuar</button><button className="danger-button" onClick={stopRecording}>Finalizar</button></>}{status === 'saving' && <button className="secondary-button" disabled>Guardando…</button>}{status === 'stopped' && <><button className="secondary-button" onClick={repeatTake}>{currentTake?.accepted ? 'Regrabar' : 'Repetir'}</button>{!currentTake?.accepted && <button className="accept-button" onClick={acceptTake}>Aceptar</button>}</>}</div></div>
                <div className="capture-meta"><span>{resolution ? `${resolution.width}×${resolution.height}` : '—'}</span><span>{resolution?.frameRate ? `${Math.round(resolution.frameRate)} fps` : '—'}</span><span>{recordingBlob ? formatBytes(recordingBlob.size) : 'Sin toma'}</span></div>
              </div>
              <aside className="production-card prompter-production-card"><div className="prompter-toolbar"><div><span className="eyebrow">PROMPTER</span><strong>LECTURA</strong></div><div><button onClick={() => setPrompterFontSize((value) => Math.max(16, value - 2))}>A−</button><button onClick={() => setPrompterFontSize((value) => Math.min(44, value + 2))}>A+</button></div></div><div className="speed-control"><span>Velocidad</span><input type="range" min="10" max="90" value={prompterSpeed} onChange={(event) => setPrompterSpeed(Number(event.target.value))} /><strong>{prompterSpeed}</strong></div><div className="prompter-reading" ref={prompterRef} style={{ fontSize: `${prompterFontSize}px` }}>{currentSlide.reading?.trim() ? <pre>{currentSlide.reading}</pre> : <div className="missing-reading"><strong>Falta LECTURA</strong><span>Agrégala desde Contenido.</span></div>}</div><div className="prompter-actions"><button className="secondary-button" onClick={resetPrompter}>↥ Inicio</button><button className="primary-button small" onClick={() => setPrompterRunning((value) => !value)} disabled={!currentSlide.reading?.trim()}>{prompterRunning ? 'Pausar' : '▶ Iniciar'}</button></div></aside>
            </div>
            {recoveryMeta && <div className="recovery-banner"><span>Se encontró una toma interrumpida de la diapositiva {recoveryMeta.slideNumber}.</span><button onClick={recoverInterruptedRecording}>Recuperar toma</button></div>}
          </section>
        )}

        {view === 'cut' && project && (
          <section className="flow-screen cut-flow">
            <div className="flow-heading"><div><span className="eyebrow">3 · CORTE</span><h1>Limpiar cada grabación</h1><p>Recorta inicio/final y elimina silencios o errores internos.</p></div><span className="flow-counter">{cleanedCount}/{project.slides.length} limpias</span></div>
            <div className="cut-grid">
              <div className="production-card cut-list">{project.slides.map((slide, index) => { const take = takes[slide.number]; return <button key={slide.number} className={`${index === cutSlideIndex ? 'active' : ''} ${take?.cleanedBlob ? 'done' : ''}`} onClick={() => setCutSlideIndex(index)} disabled={!take?.accepted}><span>{String(slide.number).padStart(2, '0')}</span><div><strong>{slide.title}</strong><small>{!take?.accepted ? 'Falta grabación aceptada' : take?.cleanedBlob ? '✓ Limpia' : 'Pendiente de corte'}</small></div></button>; })}</div>
              <div className="production-card cut-editor">{cutTake?.accepted ? <><div className="cut-video">{cutTake.mode === 'audio' ? <audio src={cutUrl} controls /> : <video src={cutUrl} controls playsInline />}</div><div className="trim-controls"><label><span>Inicio</span><input type="number" min="0" step="0.1" value={trimStart} onChange={(event) => setTrimStart(Number(event.target.value))} /></label><div className="trim-track"><div /><span>{formatTime(cutTake.durationMs || 0)}</span></div><label><span>Final</span><input type="number" min="0.1" step="0.1" value={trimEnd} onChange={(event) => setTrimEnd(Number(event.target.value))} /></label></div><div className="internal-cut-editor"><strong>Cortes internos</strong><div className="internal-cut-inputs"><label><span>Desde</span><input type="number" min={trimStart} step="0.1" value={rangeStart} onChange={(event) => setRangeStart(Number(event.target.value))} /></label><label><span>Hasta</span><input type="number" min={trimStart} step="0.1" value={rangeEnd} onChange={(event) => setRangeEnd(Number(event.target.value))} /></label><button className="secondary-button" onClick={addInternalCut}>Eliminar tramo</button></div><div className="cut-range-list">{removedRanges.length ? removedRanges.map((range, index) => <span key={`${range.start}-${range.end}-${index}`}>{range.start.toFixed(1)}–{range.end.toFixed(1)} s <button onClick={() => setRemovedRanges((old) => old.filter((_item, i) => i !== index))}>×</button></span>) : <small>Sin cortes internos.</small>}</div></div><div className="cut-summary"><span>Original: {formatTime(cutTake.durationMs)}</span><span>Salida estimada: {formatTime(cleanedDurationSeconds(Number(trimStart) || 0, Number(trimEnd) || 0, removedRanges) * 1000)}</span><span>{cutTake.cleanedBlob ? `Limpia: ${formatBytes(cutTake.cleanedBlob.size)}` : 'Sin versión limpia'}</span></div><button className="primary-button" onClick={applyCut} disabled={cutting}>{cutting ? `Procesando ${Math.round(cutProgress * 100)}%` : 'Guardar corte limpio'}</button></> : <div className="empty-state">Selecciona una diapositiva grabada y aceptada.</div>}</div>
            </div>
          </section>
        )}

        {view === 'library' && (
          <section className="flow-screen library-flow">
            <div className="flow-heading"><div><span className="eyebrow">4 · BIBLIOTECA</span><h1>Recursos reutilizables</h1><p>Biblioteca Global y Biblioteca del Proyecto. Los archivos se copian dentro de la carpeta library de Videos Studio.</p></div><button className="primary-button small" onClick={importLibraryMedia}>+ Agregar videos</button></div>
            <div className="library-switches"><div className="scope-switch"><button className={libraryScope === 'global' ? 'active' : ''} onClick={() => setLibraryScope('global')}>Global</button><button className={libraryScope === 'project' ? 'active' : ''} onClick={() => setLibraryScope('project')} disabled={!project}>Proyecto actual</button></div><div className="category-tabs">{LIBRARY_CATEGORIES.map(([key, label]) => <button key={key} className={libraryCategory === key ? 'active' : ''} onClick={() => setLibraryCategory(key)}>{label}</button>)}</div></div>
            <div className="library-grid">{libraryItems.length ? libraryItems.map((item) => <article className="library-card" key={item.id}><div className="library-thumb"><span>VIDEO</span></div><div className="library-info"><strong>{item.name}</strong><small>{formatBytes(item.size)} · {item.scope === 'global' ? 'Global' : 'Proyecto'}</small></div><div className="library-actions">{item.scope === 'global' && <button className={libraryDefaults[item.category] === item.path ? 'defaulted' : ''} onClick={() => setLibraryDefault(item)}>{libraryDefaults[item.category] === item.path ? '★ Predeterminado' : '☆ Predeterminar'}</button>}<button onClick={() => window.videosStudio?.library?.open({ path: item.path })}>Abrir</button><button onClick={() => window.videosStudio?.library?.reveal({ path: item.path })}>Carpeta</button><button className="danger-text" onClick={() => removeLibraryMedia(item)}>Eliminar</button></div></article>) : <div className="empty-library"><strong>Esta categoría está vacía.</strong><span>Agrega tus intros, transiciones, endings, CTA o video memes.</span></div>}</div>
          </section>
        )}

        {view === 'join' && project && (
          <section className="flow-screen join-flow">
            <div className="flow-heading"><div><span className="eyebrow">5 · UNIÓN</span><h1>Componer las escenas</h1><p>Combina video limpio + datos + visual + intro + transiciones + CTA + ending.</p></div><div className="theme-switch"><button className={defaults.theme === 'gold' ? 'active' : ''} onClick={() => saveProjectPlan({ theme: 'gold', scenes: {} })}>Dorado</button><button className={defaults.theme === 'blue' ? 'active' : ''} onClick={() => saveProjectPlan({ theme: 'blue', scenes: {} })}>Azul</button><button className={defaults.theme === 'green' ? 'active' : ''} onClick={() => saveProjectPlan({ theme: 'green', scenes: {} })}>Verde</button></div></div>
            <div className="join-top-settings production-card"><label><span>Intro</span><select value={defaults.intro || INHERIT} onChange={(event) => saveProjectPlan({ intro: event.target.value })}><option value={INHERIT}>Usar intro predeterminado</option><option value={NONE}>Sin intro</option>{(resourcePool.intros || []).map((item) => <option key={item.id} value={item.path}>{item.name}</option>)}</select></label><label><span>Transición predeterminada</span><select value={defaults.transitionDefault || INHERIT} onChange={(event) => saveProjectPlan({ transitionDefault: event.target.value })}><option value={INHERIT}>Usar predeterminada global</option><option value={NONE}>Sin transición</option>{(resourcePool.transitions || []).map((item) => <option key={item.id} value={item.path}>{item.name}</option>)}</select></label><label><span>Ending</span><select value={defaults.ending || INHERIT} onChange={(event) => saveProjectPlan({ ending: event.target.value })}><option value={INHERIT}>Usar ending predeterminado</option><option value={NONE}>Sin ending</option>{(resourcePool.endings || []).map((item) => <option key={item.id} value={item.path}>{item.name}</option>)}</select></label></div>
            <div className="join-grid">
              <div className="production-card join-scene-list">{project.slides.map((slide, index) => <button key={slide.number} className={`${index === joinSlideIndex ? 'active' : ''} ${project.productionPlan.scenes?.[slide.number]?.ready ? 'done' : ''}`} onClick={() => setJoinSlideIndex(index)}><span>{String(slide.number).padStart(2, '0')}</span><div><strong>{slide.title}</strong><small>{takes[slide.number]?.cleanedBlob ? 'Video limpio ✓' : 'Falta corte'} · {slide.visual ? 'Visual ✓' : 'Visual —'}</small></div></button>)}</div>
              {joinSlide && <div className={`scene-composer theme-${defaults.theme || 'blue'}`}><div className="scene-visual"><span>VISUAL PRINCIPAL</span><pre>{joinSlide.visual || 'Falta definir VISUAL desde Contenido.'}</pre></div><div className="scene-data"><span>DATOS CLAVE</span><h2>{joinSlide.title}</h2><pre>{`${joinSlide.body}\n${joinSlide.content}`}</pre></div><div className="scene-presenter"><span>TU GRABACIÓN</span>{joinVideoUrl ? (joinTake?.mode === 'audio' ? <audio src={joinVideoUrl} controls /> : <video src={joinVideoUrl} controls playsInline />) : <div>Falta video limpio</div>}</div></div>}
              <div className="production-card join-inspector">{joinSlide && <><strong>Diapositiva {joinSlide.number}</strong><label><span>Transición después de esta escena</span><select value={project.productionPlan.transitions?.[joinSlide.number] || INHERIT} onChange={(event) => updateSceneTransition(event.target.value)}><option value={INHERIT}>Usar predeterminada</option><option value={NONE}>Sin transición</option>{(resourcePool.transitions || []).map((item) => <option key={item.id} value={item.path}>{item.name}</option>)}</select></label>{isActiveCta(joinSlide.cta) && <label><span>Video CTA</span><select value={project.productionPlan.ctaAssets?.[joinSlide.number] || INHERIT} onChange={(event) => updateSceneCta(event.target.value)}><option value={INHERIT}>Usar CTA predeterminado</option><option value={NONE}>Sin clip CTA</option>{(resourcePool.cta || []).map((item) => <option key={item.id} value={item.path}>{item.name}</option>)}</select></label>}<div className="join-readonly"><span>GANCHO</span><p>{joinSlide.hook || '—'}</p><span>CTA</span><pre>{joinSlide.cta || 'TIPO: NINGUNO'}</pre></div><button className="primary-button" onClick={markSceneReady} disabled={!joinTake?.cleanedBlob}>Marcar escena lista</button></>}</div>
            </div>
          </section>
        )}

        {view === 'memes' && project && (
          <section className="flow-screen memes-flow">
            <div className="flow-heading"><div><span className="eyebrow">6 · VIDEO MEMES</span><h1>Pausar, desenfocar y mostrar meme</h1><p>El video principal se congela; aparece el meme; al terminar, continúa exactamente donde estaba.</p></div></div>
            <div className="memes-grid">
              <div className="production-card meme-form"><label><span>Diapositiva</span><select value={memeSlideIndex} onChange={(event) => setMemeSlideIndex(Number(event.target.value))}>{project.slides.map((slide, index) => <option key={slide.number} value={index}>{slide.number}. {slide.title}</option>)}</select></label><label><span>Video meme</span><select value={memeAsset} onChange={(event) => setMemeAsset(event.target.value)}><option value="">Seleccionar meme</option>{memeOptions.map((item) => <option key={item.id} value={item.path}>{item.name}</option>)}</select></label><label><span>Segundo donde aparece</span><input type="number" min="0" step="0.1" value={memeAt} onChange={(event) => setMemeAt(Number(event.target.value))} /></label><label><span>Desenfoque del fondo</span><input type="range" min="0" max="24" value={memeBlur} onChange={(event) => setMemeBlur(Number(event.target.value))} /><strong>{memeBlur}px</strong></label><label><span>Tamaño del meme</span><select value={memeSize} onChange={(event) => setMemeSize(event.target.value)}><option value="small">Pequeño</option><option value="medium">Mediano</option><option value="large">Grande</option></select></label><button className="primary-button" onClick={addMemeEvent}>Insertar video meme</button></div>
              <div className="meme-preview"><div className="meme-background" style={{ filter: `blur(${memeBlur}px)` }}><span>VIDEO PRINCIPAL PAUSADO</span></div><div className={`meme-overlay meme-${memeSize}`}><strong>{memeAsset ? fileName(memeAsset) : 'VIDEO MEME'}</strong><span>Se reproduce aquí y luego continúa el video principal.</span></div></div>
              <div className="production-card meme-events"><strong>Memes programados</strong>{(project.productionPlan.memes || []).length ? project.productionPlan.memes.map((item) => <div className="meme-event" key={item.id}><div><strong>Diapositiva {item.slideNumber} · {item.atSeconds}s</strong><small>{fileName(item.assetPath)} · blur {item.blur}px · {item.size}</small></div><button onClick={() => removeMemeEvent(item.id)}>×</button></div>) : <div className="empty-state">Todavía no hay video memes insertados.</div>}</div>
            </div>
          </section>
        )}

        {view === 'result' && project && (
          <section className="flow-screen result-flow">
            <div className="flow-heading"><div><span className="eyebrow">7 · RESULTADO</span><h1>Control final del proyecto</h1><p>El video final se construirá únicamente con versiones limpias, escenas revisadas y recursos existentes.</p></div></div>
            <div className="result-cards"><div className={acceptedCount === project.slides.length ? 'ok' : ''}><strong>{acceptedCount}/{project.slides.length}</strong><span>Grabaciones aceptadas</span></div><div className={cleanedCount === project.slides.length ? 'ok' : ''}><strong>{cleanedCount}/{project.slides.length}</strong><span>Videos limpios</span></div><div className={mountedCount === project.slides.length ? 'ok' : ''}><strong>{mountedCount}/{project.slides.length}</strong><span>Escenas montadas</span></div><div className={missingAssetCount === 0 ? 'ok' : ''}><strong>{missingAssetCount}</strong><span>Recursos faltantes</span></div></div>
            {(missingCtaCount > 0 || visualMissingCount > 0 || invalidMemeCount > 0 || missingAssetCount > 0) && <div className="production-card audit-issues"><strong>Antes del render</strong>{missingCtaCount > 0 && <span>{missingCtaCount} CTA necesitan un video asignado.</span>}{visualMissingCount > 0 && <span>{visualMissingCount} diapositivas no tienen VISUAL.</span>}{invalidMemeCount > 0 && <span>{invalidMemeCount} memes están fuera de la duración válida de su escena.</span>}{missingAssetCount > 0 && <span>{missingAssetCount} recursos seleccionados ya no existen en la Biblioteca.</span>}</div>}
            <div className="production-card final-sequence"><strong>Secuencia del video</strong><div className="sequence-strip"><span>INTRO<br/><small>{resolvedIntro ? fileName(resolvedIntro) : 'Sin intro'}</small></span><i>→</i><span>ESCENAS 1–{project.slides.length}<br/><small>transiciones entre escenas</small></span><i>→</i><span>MEMES<br/><small>{project.productionPlan.memes?.length || 0} programados</small></span><i>→</i><span>ENDING<br/><small>{resolvedEnding ? fileName(resolvedEnding) : 'Sin ending'}</small></span></div></div>
            <div className={`final-status production-card ${resultReady ? 'ready' : ''}`}>{resultReady ? <><strong>Proyecto preparado para render final.</strong><span>Grabaciones, cortes, montajes, CTA y recursos están validados.</span><button className="primary-button" disabled>Generar MP4 final · motor de render en la siguiente fase</button></> : <><strong>El proyecto todavía no está listo.</strong><span>Completa los pasos pendientes antes del MP4 final.</span><div className="final-shortcuts"><button className="secondary-button" onClick={() => navigate('recording')}>Grabación</button><button className="secondary-button" onClick={() => navigate('cut')}>Corte</button><button className="secondary-button" onClick={() => navigate('join')}>Unión</button></div></>}</div>
          </section>
        )}
      </main>

      {(error || notice) && <div className={`production-toast ${error ? 'error' : 'success'}`}><span>{error || notice}</span><button onClick={() => error ? setError('') : setNotice('')}>×</button></div>}
    </div>
  );
}
