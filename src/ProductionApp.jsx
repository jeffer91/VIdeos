import { useEffect, useMemo, useRef, useState } from 'react';
import RecordingViewEnhancer, { FramingGuides } from './RecordingViewEnhancer';
import { readPrompterPreference, waitForCountdown } from './recordingPreferences';
import { cutMedia, enhanceMediaAudio, createAudioComparison } from './ffmpeg';
import { DEFAULT_AUDIO_EFFECTS, normalizeAudioEffects, hasAudioEffects } from './audioEffects';
import { readProcessingPreferences, saveProcessingPreferences } from './processingPreferences';
import ProcessingOptionsPanel from './ProcessingOptionsPanel';
import './processing-options.css';
import { AI_MASTER_PROMPT, parseSlides } from './parser';
import { CINEMA_MASTER_PROMPT } from './cinemaPrompt';
import {
  clearRecordingData,
  deleteSlideTake,
  getActiveProject,
  getChunks,
  getProjectTakes,
  getRecordingMeta,
  getSlideTake,
  getPendingRetake,
  getProjectPendingRetakes,
  savePendingRetake,
  deletePendingRetake,
  commitAcceptedRetake,
  saveChunk,
  saveProject,
  saveSlideTake,
  saveCleanedTake,
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
  const [entry, setEntry] = useState({ blob: null, url: '' });
  useEffect(() => {
    if (!blob) {
      setEntry({ blob: null, url: '' });
      return undefined;
    }
    const url = URL.createObjectURL(blob);
    setEntry({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  // When switching slides, never show the previous slide's object URL
  // while the new Blob URL is being created in an effect.
  return entry.blob === blob ? entry.url : '';
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
    contentMode: project.contentMode || 'football',
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

export default function ProductionApp({ contentMode = 'football', onChangeContentMode }) {
  const isCinema = contentMode === 'cinema';
  const activePrompt = isCinema ? CINEMA_MASTER_PROMPT : AI_MASTER_PROMPT;
  const promptFilename = isCinema ? 'prompt-maestro-cine-videos-studio.txt' : 'prompt-maestro-11-records-videos-studio.txt';

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
  const [pendingRetake, setPendingRetake] = useState(null);
  const [acceptingTake, setAcceptingTake] = useState(false);
  const [prompterFontSize, setPrompterFontSize] = useState(() => readPrompterPreference('font', 40, 28, 56));
  const [prompterSpeed, setPrompterSpeed] = useState(() => readPrompterPreference('speed', 18, 5, 45));
  const [prompterRunning, setPrompterRunning] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [readingProgress, setReadingProgress] = useState(0);
  const [recordingView, setRecordingView] = useState('camera');
  const [guides, setGuides] = useState(true);
  const countdownRef = useRef(null);
  const prompterDelayRef = useRef(null);
  const resumePrompterRef = useRef(false);
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
  const [processOptions, setProcessOptions] = useState(readProcessingPreferences);
  const [processState, setProcessState] = useState({ phase: 'idle', method: '', progress: null, diagnostics: [] });
  const [processElapsed, setProcessElapsed] = useState(0);
  const [processStartedAt, setProcessStartedAt] = useState(0);
  const processControllerRef = useRef(null);
  const [audioEffects, setAudioEffects] = useState(DEFAULT_AUDIO_EFFECTS);
  const [audioPreviewBusy, setAudioPreviewBusy] = useState(false);
  const [audioComparison, setAudioComparison] = useState(null);
  const [audioPreviewChoice, setAudioPreviewChoice] = useState('improved');
  const [audioPreviewError, setAudioPreviewError] = useState('');
  const [recordFit, setRecordFit] = useState('contain');
  const [recordZoom, setRecordZoom] = useState(100);
  const [showCutResult, setShowCutResult] = useState(false);

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

  useEffect(() => {
    if (!processStartedAt) return undefined;
    const update = () => setProcessElapsed(Math.floor((Date.now() - processStartedAt) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [processStartedAt]);

  function updateProcessOptions(value) {
    setProcessOptions(saveProcessingPreferences(value));
  }
  function cancelProcessing() {
    processControllerRef.current?.abort();
    setProcessState((old) => ({ ...old, phase: 'cancelling' }));
  }

  const currentSlide = project?.slides?.[currentSlideIndex] || null;
  const currentTake = currentSlide ? takes[currentSlide.number] : null;
  const recordingUrl = useBlobUrl(recordingBlob);
  const recordingPreviewStyle = {
    '--preview-fit': recordFit,
    transform: status === 'stopped'
      ? `scale(${recordZoom / 100})`
      : `scaleX(-1) scale(${recordZoom / 100})`,
  };

  const cutSlide = project?.slides?.[cutSlideIndex] || null;
  const cutTake = cutSlide ? takes[cutSlide.number] : null;
  // Always edit the original, never apply destructive effects a second time.
  const cutBlob = cutTake?.blob || null;
  const cutUrl = useBlobUrl(cutBlob);
  const originalSampleUrl = useBlobUrl(audioComparison?.original || null);
  const improvedSampleUrl = useBlobUrl(audioComparison?.improved || null);
  const cutResultUrl = useBlobUrl(cutTake?.cleanedBlob || null);

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

  const focusRecording = ['countdown', 'recording', 'paused'].includes(status);
  const busyRecording = ['detecting', 'countdown', 'recording', 'paused', 'saving'].includes(status) || acceptingTake;

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

  useEffect(() => {
    try {
      localStorage.setItem('videosstudio:prompter:font', String(prompterFontSize));
      localStorage.setItem('videosstudio:prompter:speed', String(prompterSpeed));
    } catch { /* Reading controls still work when storage is unavailable. */ }
  }, [prompterFontSize, prompterSpeed]);

  function clearPrompterDelay() {
    clearTimeout(prompterDelayRef.current);
    prompterDelayRef.current = null;
  }

  function togglePrompter() {
    clearPrompterDelay();
    setPrompterRunning((value) => !value);
  }

  function updateReadingProgress() {
    const box = prompterRef.current;
    if (!box) return;
    const max = box.scrollHeight - box.clientHeight;
    setReadingProgress(max > 0 ? Math.min(100, Math.round(box.scrollTop / max * 100)) : 0);
  }

  useEffect(() => {
    const box = prompterRef.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(updateReadingProgress);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, [view, currentSlideIndex, prompterFontSize, focusRecording]);

  function resetPrompter() {
    clearPrompterDelay();
    setReadingProgress(0);
    setPrompterRunning(false);
    if (prompterRef.current) prompterRef.current.scrollTop = 0;
  }

  useEffect(() => {
    if (!prompterRunning) return undefined;
    let frame;
    let last = performance.now();
    let fraction = 0;
    const move = (now) => {
      const box = prompterRef.current;
      if (!box) return;
      const delta = Math.min(80, now - last);
      last = now;
      fraction += (prompterSpeed * delta) / 1000;
      const pixels = Math.floor(fraction);
      fraction -= pixels;
      box.scrollTop += pixels;
      updateReadingProgress();
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
        const storedActive = normalizeProject(await getActiveProject());
        const active = storedActive?.contentMode === contentMode ? storedActive : null;
        const meta = await getRecordingMeta();
        const chunks = meta ? await getChunks() : [];
        if (meta && chunks.length && meta.projectId && meta.slideNumber) setRecoveryMeta(meta);
        else if (chunks.length) await clearRecordingData();

        if (active) {
          const [rows, drafts] = await Promise.all([
            getProjectTakes(active.id),
            getProjectPendingRetakes(active.id),
          ]);
          if (!mountedRef.current) return;
          const mapped = rowsToMap(rows);
          setProject(active);
          setRawText(active.rawText || '');
          setTakes(mapped);
          const draftIndex = drafts.length
            ? active.slides.findIndex((slide) => Number(slide.number) === Number(drafts[0].slideNumber))
            : -1;
          const pending = active.slides.findIndex((slide) => !mapped[slide.number]?.accepted);
          setCurrentSlideIndex(draftIndex >= 0 ? draftIndex : pending >= 0 ? pending : 0);
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
      countdownRef.current?.abort();
      clearPrompterDelay();
      navigator.mediaDevices?.removeEventListener?.('devicechange', deviceChange);
      stopMediaStream();
    };
  }, [contentMode]);

  useEffect(() => {
    if (view !== 'recording' || !project || !currentSlide) {
      stopMediaStream();
      return;
    }
    let cancelled = false;
    stopMediaStream();
    setRetaking(false);
    setPendingRetake(null);
    setStatus('detecting');
    setRecordingView('camera');
    resetPrompter();
    const projectId = project.id;
    const slideNumber = currentSlide.number;
    const load = async () => {
      try {
        const draft = await getPendingRetake(projectId, slideNumber);
        if (cancelled) return;
        const take = draft || takes[slideNumber];
        if (take?.blob) {
          setPendingRetake(draft || null);
          setRecordingBlob(take.blob);
          setMode(take.mode || 'video');
          elapsedRef.current = take.durationMs || 0;
          setElapsedMs(elapsedRef.current);
          setResolution(take.width && take.height
            ? { width: take.width, height: take.height, frameRate: take.frameRate || 0 }
            : null);
          setStatus('stopped');
          if (draft) setNotice(`Diapositiva ${slideNumber}: tienes una nueva toma pendiente de aceptar. La anterior sigue guardada.`);
        } else {
          setRecordingBlob(null);
          elapsedRef.current = 0;
          setElapsedMs(0);
          await openStream({ mode, cameraId, microphoneId });
        }
      } catch (caught) {
        if (cancelled) return;
        console.error('Error al recuperar el borrador de grabación:', caught);
        setStatus('idle');
        setError('No se pudo comprobar si hay una toma pendiente. No grabes hasta recuperar el almacenamiento local.');
      }
    };
    load();
    return () => { cancelled = true; };
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
    setAudioEffects(normalizeAudioEffects(cutTake.audioEffects));
    setAudioComparison(null);
    setAudioPreviewError('');
    setShowCutResult(false);
    setRangeStart(start);
    setRangeEnd(Math.min(end, start + 1));
  }, [cutSlideIndex, cutTake?.updatedAt]);

  async function copyAiPrompt() {
    try {
      const nativeWriter = window.videosStudio?.clipboard?.writeText;
      if (typeof nativeWriter === 'function') {
        const result = await nativeWriter(activePrompt);
        if (!result?.ok || (result.verified === true && Number(result.length) !== activePrompt.length)) {
          throw new Error('El portapapeles no confirmó la copia completa.');
        }
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activePrompt);
      } else {
        throw new Error('El portapapeles no está disponible.');
      }
      setError('');
      setNotice(isCinema ? 'Prompt de cine copiado. Pégalo en tu IA, indica la película y trae aquí únicamente el guion generado.' : 'Prompt maestro copiado. Pégalo en tu IA, agrega el tema y trae aquí únicamente el guion generado.');
    } catch (caught) {
      console.error(caught);
      setError('No se pudo copiar el prompt. Usa “Descargar prompt” como respaldo.');
    }
  }

  function parseContent() {
    const result = parseSlides(rawText);
    setParseResult(result);
    setError('');
  }

  async function loadContentFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    const result = parseSlides(text);
    setParseResult(result);
    setError('');
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
      contentMode,
      slides: result.slides,
      productionPlan: plan,
      createdAt: project?.createdAt || Date.now(),
      updatedAt: Date.now(),
    });

    await saveProject(next);
    window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
    setProject(next);
    setTakes(project ? nextTakes : {});
    const firstPending = result.slides.findIndex((slide) => !nextTakes[slide.number]?.accepted);
    setCurrentSlideIndex(firstPending >= 0 ? firstPending : 0);
    setParseResult(null);
    setView('recording');
    setNotice(project ? 'Contenido actualizado. Las tomas afectadas quedaron marcadas para revisión.' : 'Proyecto creado.');
    setError('');
  }

  function cancelCountdown() {
    countdownRef.current?.abort();
    setStatus('ready');
    resetPrompter();
  }

  async function startRecording() {
    if (countdownRef.current || status !== 'ready') return;
    if (!project || !currentSlide?.reading?.trim()) {
      setError(`La diapositiva ${currentSlide?.number || ''} no tiene LECTURA.`);
      return;
    }
    let stream = streamRef.current;
    if (!stream) stream = await openStream();
    if (!stream) return;

    const controller = new AbortController();
    countdownRef.current = controller;
    setError('');
    setNotice('');
    setStatus('countdown');
    setCountdown(3);
    resetPrompter();
    try {
      for (const number of [3, 2, 1]) {
        setCountdown(number);
        if (!await waitForCountdown(controller.signal)) return;
      }
      await navigator.storage?.persist?.();
      if (controller.signal.aborted) return;
      const unfinished = await getRecordingMeta();
      if (unfinished?.projectId && (await getChunks()).length) {
        setError('Hay una grabación interrumpida pendiente. Recupérala o descártala antes de iniciar otra.');
        setStatus('ready');
        return;
      }
      await clearRecordingData();
      if (controller.signal.aborted) return;
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
          // Never overwrite an existing take until the user accepts the new one.
          // An unsuccessful retake must not destroy their previous recording.
          const savedOriginal = await getSlideTake(projectId, slideNumber);
          const hasPreviousTake = Boolean(savedOriginal?.blob);
          if (hasPreviousTake) {
            await savePendingRetake(projectId, slideNumber, take);
            setPendingRetake(take);
          } else {
            await saveSlideTake(projectId, slideNumber, take);
            setTakes((old) => ({ ...old, [slideNumber]: take }));
            window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
          }
          await clearRecordingData();
          setRecordingBlob(blob);
          setStatus('stopped');
          setRetaking(false);
          setRecoveryMeta(null);
          setNotice(hasPreviousTake
            ? `Nueva toma ${slideNumber} pendiente. Acepta para reemplazar la anterior o consérvala.`
            : `Toma ${slideNumber} lista para revisar.`);
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

      recordingStartedAtRef.current = 0;
      pausedStartedAtRef.current = 0;
      pausedTotalRef.current = 0;
      elapsedRef.current = 0;
      setElapsedMs(0);
      resetPrompter();
      await setRecordingMeta({ sessionId, projectId, slideNumber, mode, mimeType: recorder.mimeType || mimeType, createdAt: Date.now() });
      if (controller.signal.aborted) return;
      recorder.start(1000);
      recordingStartedAtRef.current = Date.now();
      setStatus('recording');
      prompterDelayRef.current = setTimeout(() => {
        prompterDelayRef.current = null;
        if (mountedRef.current && recorder.state === 'recording') setPrompterRunning(true);
      }, 1000);
    } catch (caught) {
      console.error(caught);
      setError('No se pudo iniciar la grabación.');
      setStatus(streamRef.current ? 'ready' : 'idle');
      recorderRef.current = null;
    } finally {
      if (countdownRef.current === controller) countdownRef.current = null;
    }
  }

  function pauseRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state !== 'recording') return;
    resumePrompterRef.current = prompterRunning || prompterDelayRef.current !== null;
    clearPrompterDelay();
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
    setPrompterRunning(resumePrompterRef.current);
    setStatus('recording');
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    updateElapsed();
    clearPrompterDelay();
    setPrompterRunning(false);
    recorder.stop();
    setStatus('saving');
  }

  async function acceptTake() {
    if (!project || !currentSlide || !recordingBlob || acceptingTake) return;
    const previous = takes[currentSlide.number] || {};
    const replacing = Boolean(pendingRetake);
    const nextTake = replacing
      ? { ...pendingRetake, accepted: true, cleanedBlob: null, cleanedDurationMs: null, cleanedAt: null,
          trimStart: 0, trimEnd: null, removedRanges: [] }
      : { ...previous, blob: recordingBlob, accepted: true, durationMs: elapsedRef.current };
    setAcceptingTake(true);
    setError('');
    try {
      if (replacing) {
        const updatedProject = await commitAcceptedRetake(project.id, currentSlide.number, nextTake);
        setProject(normalizeProject(updatedProject));
      } else {
        await saveSlideTake(project.id, currentSlide.number, nextTake);
      }
      const nextMap = { ...takes, [currentSlide.number]: nextTake };
      setTakes(nextMap);
      setPendingRetake(null);
      setRetaking(false);
      setNotice(`Diapositiva ${currentSlide.number} aceptada.`);
      window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));

      const pending = project.slides.findIndex((slide) => !nextMap[slide.number]?.accepted);
      if (pending >= 0) setCurrentSlideIndex(pending);
      else {
        const firstUnclean = project.slides.findIndex((slide) => !nextMap[slide.number]?.cleanedBlob);
        setCutSlideIndex(replacing ? currentSlideIndex : firstUnclean >= 0 ? firstUnclean : 0);
        setView('cut');
      }
    } catch (caught) {
      console.error('No se pudo aceptar la nueva toma.', caught);
      setError(caught?.message || 'No se pudo aceptar la grabación. La anterior sigue guardada.');
    } finally {
      setAcceptingTake(false);
    }
  }

  async function repeatTake() {
    if (pendingRetake) {
      if (!window.confirm('Hay una nueva toma pendiente. ¿Descartarla para grabar otra? La anterior se conservará.')) return;
      try {
        await deletePendingRetake(project.id, currentSlide.number);
      } catch (caught) {
        setError(caught?.message || 'No se pudo descartar la toma pendiente.');
        return;
      }
    }
    setPendingRetake(null);
    setRecordingBlob(null);
    elapsedRef.current = 0;
    setElapsedMs(0);
    resetPrompter();
    setRetaking(true);
    const stream = await openStream({ mode, cameraId, microphoneId });
    if (!stream) {
      setRetaking(false);
      setRecordingBlob(currentTake?.blob || null);
      setNotice('La grabación anterior se mantiene guardada.');
      return;
    }
    setNotice('La grabación anterior se conservará hasta que aceptes la nueva toma.');
  }

  async function discardPendingRetake() {
    if (['recording', 'paused', 'saving', 'countdown'].includes(status) || !project || !currentSlide) return;
    try {
      await deletePendingRetake(project.id, currentSlide.number);
      stopMediaStream();
      clearPrompterDelay();
      setPendingRetake(null);
      setRetaking(false);
      setRecordingBlob(currentTake?.blob || null);
      elapsedRef.current = currentTake?.durationMs || 0;
      setElapsedMs(elapsedRef.current);
      setMode(currentTake?.mode || 'video');
      setStatus(currentTake?.blob ? 'stopped' : 'idle');
      setNotice('Se conservó la grabación anterior. No se reemplazó ningún archivo.');
    } catch (caught) {
      setError(caught?.message || 'No se pudo descartar el borrador.');
    }
  }

  function rerecordSelectedCut() {
    if (!cutSlide || !cutTake?.accepted || cutting) return;
    setCurrentSlideIndex(cutSlideIndex);
    setView('recording');
    setNotice(`Diapositiva ${cutSlide.number}: comprueba la toma anterior y pulsa Regrabar.`);
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
      const previous = await getSlideTake(meta.projectId, meta.slideNumber);
      const replacing = Boolean(previous?.blob);
      if (replacing) await savePendingRetake(meta.projectId, meta.slideNumber, take);
      else await saveSlideTake(meta.projectId, meta.slideNumber, take);
      await clearRecordingData();
      if (project?.id === meta.projectId) {
        const index = project.slides.findIndex((slide) => slide.number === meta.slideNumber);
        if (replacing) setPendingRetake(take);
        else setTakes((old) => ({ ...old, [meta.slideNumber]: take }));
        if (index >= 0) setCurrentSlideIndex(index);
        setMode(take.mode);
        setRecordingBlob(blob);
        elapsedRef.current = take.durationMs;
        setElapsedMs(take.durationMs);
        setStatus('stopped');
        setView('recording');
      }
      setRecoveryMeta(null);
      setNotice(replacing
        ? `Se recuperó una nueva toma pendiente de la diapositiva ${meta.slideNumber}; la original se mantiene.`
        : `Se recuperó la toma de la diapositiva ${meta.slideNumber}.`);
      window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
    } catch (caught) {
      setError(caught.message || 'No se pudo recuperar la grabación.');
    }
  }

  function toggleAudioEffect(key) {
    if (cutting || audioPreviewBusy) return;
    setAudioEffects((previous) => ({ ...previous, [key]: !previous[key] }));
    setAudioComparison(null);
    setAudioPreviewError('');
  }

  async function compareAudioEffects() {
    if (!cutTake?.blob || cutting || audioPreviewBusy || !hasAudioEffects(audioEffects)) return;
    const fullSeconds = Math.max(0.1, (cutTake.durationMs || 0) / 1000);
    const start = Math.min(Math.max(0, Number(trimStart) || 0), Math.max(0, fullSeconds - 0.3));
    const duration = Math.min(10, Math.max(0.3, (Number(trimEnd) || fullSeconds) - start));
    const controller = new AbortController();
    processControllerRef.current = controller;
    setProcessStartedAt(Date.now());
    setProcessElapsed(0);
    setProcessState({ phase: 'loading', method: '', progress: null, diagnostics: [] });
    setAudioPreviewBusy(true);
    setAudioPreviewError('');
    setAudioComparison(null);
    try {
      const samples = await createAudioComparison(cutTake.blob, start, duration, audioEffects, {
        ...processOptions, signal: controller.signal, onStatus: setProcessState,
      });
      if (!samples.original?.size || !samples.improved?.size) throw new Error('La comparación no generó archivos válidos.');
      setAudioComparison(samples);
      setAudioPreviewChoice('improved');
    } catch (caught) {
      console.error('No se pudo comparar el audio:', caught);
      setAudioPreviewError(caught?.message || 'No se pudo crear la muestra de audio.');
    } finally {
      if (processControllerRef.current === controller) processControllerRef.current = null;
      setProcessStartedAt(0);
      setAudioPreviewBusy(false);
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
    if (!project || !cutSlide || !cutTake?.blob || cutting || audioPreviewBusy) return;
    const fullDuration = Math.max(0.1, (cutTake.durationMs || 0) / 1000);
    const start = Math.max(0, Number(trimStart) || 0);
    const end = Math.min(fullDuration, Math.max(start + 0.05, Number(trimEnd) || fullDuration));
    const ranges = mergeRanges(removedRanges, start, end);
    const outputDuration = cleanedDurationSeconds(start, end, ranges);
    if (outputDuration < 0.05) {
      setError('Los cortes eliminarían toda la grabación.');
      return;
    }

    const controller = new AbortController();
    processControllerRef.current = controller;
    setProcessStartedAt(Date.now());
    setProcessElapsed(0);
    setProcessState({ phase: 'loading', method: '', progress: null, diagnostics: [] });
    setCutting(true);
    setCutProgress(0);
    setError('');
    try {
      const unchanged = start <= 0.01 && Math.abs(end - fullDuration) <= 0.05 && !ranges.length;
      const effects = normalizeAudioEffects(audioEffects);
      const processing = { ...processOptions, signal: controller.signal, onStatus: setProcessState };
      const cleanedBlob = unchanged
        ? (hasAudioEffects(effects)
          ? await enhanceMediaAudio(cutTake.blob, cutTake.mode || 'video', effects, setCutProgress, processing)
          : cutTake.blob)
        : await cutMedia(cutTake.blob, cutTake.mode || 'video', start, end, ranges, setCutProgress, effects, processing);
      if (controller.signal.aborted) throw new Error('Procesamiento cancelado por el usuario.');
      if (!(cleanedBlob instanceof Blob) || !cleanedBlob.size) throw new Error('El procesador devolvió un resultado vacío.');

      const nextTake = {
        ...cutTake,
        cleanedBlob,
        audioEffects: effects,
        trimStart: start,
        trimEnd: end,
        removedRanges: ranges,
        cleanedAt: Date.now(),
        cleanedDurationMs: Math.round(outputDuration * 1000),
      };
      const updatedProject = await saveCleanedTake(project.id, cutSlide.number, nextTake);
      setProject(normalizeProject(updatedProject));
      const nextMap = { ...takes, [cutSlide.number]: nextTake };
      setTakes(nextMap);
      setNotice(`Diapositiva ${cutSlide.number} limpia y guardada.`);
      window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
      const nextPending = project.slides.findIndex((slide, index) => index > cutSlideIndex && nextMap[slide.number]?.accepted && !nextMap[slide.number]?.cleanedBlob);
      if (nextPending >= 0) setCutSlideIndex(nextPending);
    } catch (caught) {
      console.error(caught);
      setError(caught.message || 'No se pudo aplicar el corte. El original permanece intacto.');
    } finally {
      if (processControllerRef.current === controller) processControllerRef.current = null;
      setProcessStartedAt(0);
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

  function navigationBlockReason(nextView) {
    if (nextView === view) return '';
    if (['countdown', 'recording', 'paused', 'saving'].includes(status)) {
      return 'Finaliza la grabación antes de cambiar de pantalla.';
    }
    if (status === 'detecting') {
      return 'Espera a que termine la detección de cámara y micrófono antes de cambiar de pantalla.';
    }
    if (view === 'recording' && recoveryMeta) {
      return 'Recupera o descarta la grabación interrumpida antes de salir de Grabación.';
    }
    if (acceptingTake) return 'Espera a que se termine de guardar la grabación.';
    if (cutting || audioPreviewBusy) return 'Espera a que termine el procesamiento del corte o del audio.';
    return '';
  }

  function navigate(nextView) {
    if (!NAV_ITEMS.some(([key]) => key === nextView)) return false;
    const blocked = navigationBlockReason(nextView);
    if (blocked) {
      setError(blocked);
      return false;
    }
    if (view === 'recording' && pendingRetake && nextView !== 'recording') {
      if (!window.confirm('La toma nueva quedará guardada como borrador, sin reemplazar la anterior. ¿Salir ahora?')) return false;
    }
    setError('');
    setView(nextView);
    return true;
  }

  useEffect(() => {
    const handleNavigationRequest = (event) => {
      const nextView = event?.detail?.view;
      if (!nextView) return;
      navigate(nextView);
    };
    window.addEventListener('videosstudio:navigate', handleNavigationRequest);
    return () => window.removeEventListener('videosstudio:navigate', handleNavigationRequest);
  }, [view, status, recoveryMeta, pendingRetake, acceptingTake, cutting, audioPreviewBusy]);

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
    countdown: `Comienza en ${countdown}`,
    idle: 'Sin dispositivo',
    ready: 'Listo',
    recording: 'Grabando',
    paused: 'Pausado',
    saving: 'Guardando',
    stopped: pendingRetake ? 'Nueva toma sin aceptar' : currentTake?.accepted ? 'Aceptada' : 'Revisar toma',
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
    <div className="production-app" data-recording-focus={focusRecording ? "true" : "false"} data-accepting-take={acceptingTake ? "true" : "false"} data-processing-audio={audioPreviewBusy || cutting ? "true" : "false"}>
      <header className="production-header">
        <div className="production-brand"><strong>Videos Studio</strong><span>{isCinema ? 'Cine · análisis de películas' : 'Fútbol · 11 Records'}</span></div>
        <nav className="production-nav">
          {NAV_ITEMS.map(([key, label]) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => navigate(key)} disabled={!project && key !== 'content' && key !== 'library'}>{label}</button>
          ))}
        </nav>
        <div className="production-progress"><strong>{project ? `${acceptedCount}/${project.slides.length}` : 'Nuevo'}</strong><span>{project ? 'grabadas' : 'proyecto'}</span>{onChangeContentMode && <button className="mode-switch-button" onClick={onChangeContentMode} disabled={busyRecording}>Cambiar</button>}</div>
      </header>

      <main className="production-main">
        {view === 'content' && (
          <section className="flow-screen content-flow">
            <div className="flow-heading"><div><span className="eyebrow">1 · CONTENIDO · {isCinema ? 'CINE' : 'FÚTBOL'}</span><h1>{isCinema ? 'Cargar análisis de la película' : 'Cargar guion del video'}</h1><p>{isCinema ? 'Copia el prompt de cine en tu IA, indica la película y pega aquí únicamente el guion estructurado.' : 'Copia el prompt maestro en tu IA y pega aquí únicamente la respuesta estructurada.'}</p></div><div className="heading-actions"><button className="secondary-button" onClick={copyAiPrompt}>Copiar prompt IA</button><button className="secondary-button" onClick={() => downloadText(activePrompt, promptFilename)}>Descargar prompt</button></div></div>
            <div className="content-production-grid">
              <div className="production-card source-card">
                <div className="card-title-row"><strong>Contenido fuente</strong><label className="file-button">Cargar TXT<input type="file" accept=".txt,text/plain" onChange={loadContentFile} /></label></div>
                <textarea value={rawText} onChange={(event) => { setRawText(event.target.value); setParseResult(null); }} placeholder={'===DIAPOSITIVA 1===\n\n===GANCHO===\n...\n\n===TITULO===\n...\n\n===CUERPO===\nCUERPO_1=...\nCUERPO_2=...\n\n===CONTENIDO===\nCONTENIDO_1=...\nCONTENIDO_2=...\n\n===LECTURA===\n...\n===FIN_LECTURA===\n\n===VISUAL===\nVISUAL_TIPO=IMAGEN\nVISUAL_DESCRIPCION=...\n\n===CTA===\nCTA_TIPO=NINGUNO\nCTA_TEXTO=\n\n===FIN_DIAPOSITIVA 1==='} />
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
          <section className="flow-screen recording-flow" data-status={status} data-recording-view={focusRecording ? "prompter" : recordingView} data-framing-guides={guides ? "on" : "off"}>
            <div className="slide-flow-header"><button onClick={() => setCurrentSlideIndex((value) => Math.max(0, value - 1))} disabled={busyRecording || currentSlideIndex === 0}>←</button><div><span>DIAPOSITIVA {currentSlide.number} DE {project.slides.length}</span><h1>{currentSlide.title}</h1><span className={`recording-header-status state-${status}`}>{statusLabel}</span></div><button onClick={() => setCurrentSlideIndex((value) => Math.min(project.slides.length - 1, value + 1))} disabled={busyRecording || currentSlideIndex === project.slides.length - 1}>→</button></div>
            <div className="slide-mini-rail">{currentSlideWindow.map((slide) => { const index = project.slides.findIndex((item) => item.number === slide.number); const take = takes[slide.number]; return <button key={slide.number} className={index === currentSlideIndex ? 'current' : ''} onClick={() => setCurrentSlideIndex(index)} disabled={busyRecording}><span>{slide.number}</span><small>{take?.accepted ? '✓' : take?.blob ? '◐' : '○'}</small></button>; })}</div>
            <div className="recording-production-grid">
              {!busyRecording && status !== 'stopped' && <RecordingViewEnhancer viewMode={recordingView} guides={guides} running={prompterRunning} onCamera={() => { setRecordingView('camera'); resetPrompter(); }} onPractice={() => { setRecordingView('prompter'); togglePrompter(); }} onGuides={() => setGuides((value) => !value)} />}
              <div className="production-card camera-production-card">
                <div className="recording-topline"><div className="mode-switch"><button className={mode === 'video' ? 'active' : ''} onClick={() => { setMode('video'); openStream({ mode: 'video' }); }} disabled={busyRecording || (!!currentTake?.blob && !retaking)}>Video + audio</button><button className={mode === 'audio' ? 'active' : ''} onClick={() => { setMode('audio'); openStream({ mode: 'audio' }); }} disabled={busyRecording || (!!currentTake?.blob && !retaking)}>Solo audio</button></div><div className="device-selects">{mode === 'video' && <select value={cameraId} onChange={(event) => { setCameraId(event.target.value); openStream({ cameraId: event.target.value }); }} disabled={busyRecording || status === 'stopped'}><option value="">Cámara predeterminada</option>{devices.cameras.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Cámara ${index + 1}`}</option>)}</select>}<select value={microphoneId} onChange={(event) => { setMicrophoneId(event.target.value); openStream({ microphoneId: event.target.value }); }} disabled={busyRecording || status === 'stopped'}><option value="">Micrófono predeterminado</option>{devices.microphones.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Micrófono ${index + 1}`}</option>)}</select></div><span className={`status-pill status-${status}`}><i className="status-dot" />{statusLabel}</span></div>
                <div className="production-stage">{guides && recordingView === 'camera' && !busyRecording && status !== 'stopped' && <FramingGuides />}{status === 'countdown' && <div className="recording-countdown" role="status"><strong>{countdown}</strong><span>Prepárate · aún no se está grabando</span></div>}{mode === 'video' ? (recordingUrl && status === 'stopped' ? <video src={recordingUrl} controls playsInline style={{ '--preview-fit': recordFit, transform: `scale(${recordZoom / 100})` }} /> : <video ref={liveVideoRef} className="live-video" muted autoPlay playsInline style={recordingPreviewStyle} />) : <div className="audio-stage">{recordingUrl && status === 'stopped' ? <audio src={recordingUrl} controls /> : 'Micrófono preparado'}</div>}{(status === 'recording' || status === 'paused') && <div className="rec-indicator">{status === 'paused' ? 'PAUSA' : 'REC'}</div>}</div>
                {mode === 'video' && !focusRecording && <div className="recording-frame-tools" aria-label="Escala de la vista previa"><span>Encuadre</span><button type="button" className={recordFit === 'contain' ? 'active' : ''} onClick={() => setRecordFit('contain')} title="Mostrar la imagen completa">Ajustar</button><button type="button" className={recordFit === 'cover' ? 'active' : ''} onClick={() => setRecordFit('cover')} title="Llenar el reproductor, con posible recorte de bordes">Llenar</button><label>Zoom <input type="range" min="100" max="150" step="5" value={recordZoom} onChange={(event) => setRecordZoom(Number(event.target.value))} aria-label="Zoom de vista previa" /></label><strong>{recordZoom}%</strong><button type="button" onClick={() => { setRecordFit('contain'); setRecordZoom(100); }}>Restablecer</button><small>Solo visual; no modifica el archivo grabado.</small></div>}
                <div className="recording-bottom"><div className="mic-meter"><span>MIC</span><div><i style={{ width: `${Math.max(streamRef.current ? 2 : 0, micLevel)}%` }} /></div><strong>{micLevel}%</strong></div><div className="record-clock">{formatTime(elapsedMs)}</div><div className="record-actions">{status === 'ready' && <><button className="record-button" onClick={startRecording} disabled={!currentSlide.reading?.trim()}>Grabar</button>{retaking && currentTake?.blob && <button className="secondary-button" onClick={discardPendingRetake}>Cancelar regrabación</button>}</>}{status === 'countdown' && <button className="secondary-button" onClick={cancelCountdown}>Cancelar</button>}{status === 'detecting' && <button className="secondary-button" disabled>Detectando…</button>}{status === 'idle' && <><button className="secondary-button" onClick={() => openStream()}>Reintentar</button>{currentTake?.blob && <button className="secondary-button" onClick={discardPendingRetake}>Conservar anterior</button>}</>}{status === 'recording' && <><button className="secondary-button" onClick={pauseRecording}>Pausar</button><button className="danger-button" onClick={stopRecording}>Finalizar</button></>}{status === 'paused' && <><button className="primary-button small" onClick={resumeRecording}>Continuar</button><button className="danger-button" onClick={stopRecording}>Finalizar</button></>}{status === 'saving' && <button className="secondary-button" disabled>Guardando…</button>}{status === 'stopped' && <><button className="secondary-button" onClick={repeatTake} disabled={acceptingTake}>{currentTake?.accepted ? 'Regrabar' : 'Repetir'}</button>{pendingRetake && <button className="secondary-button" onClick={discardPendingRetake} disabled={acceptingTake}>Conservar anterior</button>}{(!currentTake?.accepted || pendingRetake) && <button className="accept-button" onClick={acceptTake} disabled={acceptingTake}>{pendingRetake ? 'Aceptar nueva toma' : 'Aceptar'}</button>}</>}</div></div>
                <div className="capture-meta"><span>{resolution ? `${resolution.width}×${resolution.height}` : '—'}</span><span>{resolution?.frameRate ? `${Math.round(resolution.frameRate)} fps` : '—'}</span><span>{recordingBlob ? formatBytes(recordingBlob.size) : 'Sin toma'}</span></div>
              </div>
              <aside className="production-card prompter-production-card">
                <div className="prompter-toolbar"><div><span className="eyebrow">PROMPTER</span><strong>LECTURA · {readingProgress}%</strong></div><div><button aria-label="Reducir letra" onClick={() => setPrompterFontSize((value) => Math.max(28, value - 2))}>A−</button><span>{prompterFontSize} px</span><button aria-label="Ampliar letra" onClick={() => setPrompterFontSize((value) => Math.min(56, value + 2))}>A+</button></div></div>
                <label className="speed-control"><span>Velocidad</span><input aria-label="Velocidad del texto" type="range" min="5" max="45" value={prompterSpeed} onChange={(event) => setPrompterSpeed(Number(event.target.value))} /><strong>{prompterSpeed} px/s</strong></label>
                <div className="prompter-reading" ref={prompterRef} onScroll={updateReadingProgress} style={{ fontSize: `${prompterFontSize}px` }}>{currentSlide.reading?.trim() ? <pre>{currentSlide.reading}</pre> : <div className="missing-reading"><strong>Falta LECTURA</strong><span>Agrégala desde Contenido.</span></div>}</div>
                <div className="prompter-actions"><button className="secondary-button" onClick={resetPrompter}>↥ Inicio</button><button className="primary-button small" onClick={togglePrompter} disabled={!currentSlide.reading?.trim() || ['countdown', 'paused', 'saving'].includes(status)}>{prompterRunning ? 'Pausar texto' : '▶ Iniciar texto'}</button></div>
                <progress className="reading-progress" aria-label="Avance de lectura" value={readingProgress} max="100" />
              </aside>
            </div>
            {recoveryMeta && <div className="recovery-banner"><span>Se encontró una toma interrumpida de la diapositiva {recoveryMeta.slideNumber}.</span><button onClick={recoverInterruptedRecording}>Recuperar toma</button></div>}
          </section>
        )}

        {view === 'cut' && project && (
          <section className="flow-screen cut-flow">
            <div className="flow-heading"><div><span className="eyebrow">3 · CORTE</span><h1>Limpiar cada grabación</h1><p>Recorta inicio/final y elimina silencios o errores internos.</p></div><div className="cut-heading-actions">{cutTake?.cleanedBlob && <button type="button" className="cut-saved-preview-action" onClick={() => setShowCutResult(true)} disabled={cutting || audioPreviewBusy}>▶ Ver video guardado</button>}<button type="button" className="secondary-button" onClick={rerecordSelectedCut} disabled={!cutTake?.accepted || cutting || audioPreviewBusy}>↺ Regrabar diapositiva {cutSlide?.number || ''}</button><span className="flow-counter">{cleanedCount}/{project.slides.length} limpias</span></div></div>
            <div className="cut-grid">
              <div className="production-card cut-list">{project.slides.map((slide, index) => { const take = takes[slide.number]; return <button key={slide.number} className={`${index === cutSlideIndex ? 'active' : ''} ${take?.cleanedBlob ? 'done' : ''}`} onClick={() => setCutSlideIndex(index)} disabled={!take?.accepted || cutting || audioPreviewBusy}><span>{String(slide.number).padStart(2, '0')}</span><div><strong>{slide.title}</strong><small>{!take?.accepted ? 'Falta grabación aceptada' : take?.cleanedBlob ? '✓ Limpia' : 'Pendiente de corte'}</small></div></button>; })}</div>
              <div className="production-card cut-editor">{cutTake?.accepted ? <><div className="cut-preview-layout">
  <div className="cut-video">{cutTake.mode === 'audio' ? <audio src={cutUrl} data-blob-size={cutBlob?.size || 0} controls /> : <video src={cutUrl} data-blob-size={cutBlob?.size || 0} controls playsInline />}</div>
  <aside className="cut-audio-panel" aria-label="Mejoras de audio">
    <div className="cut-audio-heading"><span className="cut-audio-icon">♫</span><div><strong>MEJORAS DE AUDIO</strong><small>Efectos de esta diapositiva</small></div></div>
    <ProcessingOptionsPanel options={processOptions} onChange={updateProcessOptions} busy={cutting || audioPreviewBusy} state={processState} elapsed={processElapsed} progress={cutProgress} onCancel={cancelProcessing} />
    <label className="cut-audio-toggle"><span><strong>Reducir ruido</strong><small>Ruido de ventilación o ambiente</small></span><input type="checkbox" checked={audioEffects.noiseReduction} onChange={() => toggleAudioEffect('noiseReduction')} disabled={cutting || audioPreviewBusy} /><i aria-hidden="true" /></label>
    <label className="cut-audio-toggle"><span><strong>Mejorar voz</strong><small>Claridad y volumen equilibrado</small></span><input type="checkbox" checked={audioEffects.voiceEnhancement} onChange={() => toggleAudioEffect('voiceEnhancement')} disabled={cutting || audioPreviewBusy} /><i aria-hidden="true" /></label>
    <div className="cut-audio-compare">
      <button type="button" className="cut-audio-preview-button" disabled={!hasAudioEffects(audioEffects) || audioPreviewBusy || cutting} onClick={compareAudioEffects}>{audioPreviewBusy ? 'Procesando muestra…' : '♫ Comparar 10 segundos'}</button>
      {audioComparison && <><div className="cut-audio-choice"><button type="button" className={audioPreviewChoice === 'original' ? 'active' : ''} onClick={() => setAudioPreviewChoice('original')}>Original</button><button type="button" className={audioPreviewChoice === 'improved' ? 'active' : ''} onClick={() => setAudioPreviewChoice('improved')}>Mejorado</button></div><audio key={audioPreviewChoice} aria-label={audioPreviewChoice === 'original' ? 'Audio original' : 'Audio mejorado'} controls preload="metadata" src={audioPreviewChoice === 'original' ? originalSampleUrl : improvedSampleUrl} /></>}
      {audioPreviewError && <small className="cut-audio-error" role="alert">{audioPreviewError}</small>}
    </div>
    <small className="cut-audio-footnote">{hasAudioEffects(audioEffects) ? 'Guarda el corte para aplicar los efectos. El original no se modifica.' : 'Sin efectos: sonido original.'}</small>
  </aside>
</div><div className="trim-controls"><label><span>Inicio</span><input type="number" min="0" step="0.1" value={trimStart} onChange={(event) => setTrimStart(Number(event.target.value))} /></label><div className="trim-track"><div /><span>{formatTime(cutTake.durationMs || 0)}</span></div><label><span>Final</span><input type="number" min="0.1" step="0.1" value={trimEnd} onChange={(event) => setTrimEnd(Number(event.target.value))} /></label></div><div className="internal-cut-editor"><strong>Cortes internos</strong><div className="internal-cut-inputs"><label><span>Desde</span><input type="number" min={trimStart} step="0.1" value={rangeStart} onChange={(event) => setRangeStart(Number(event.target.value))} /></label><label><span>Hasta</span><input type="number" min={trimStart} step="0.1" value={rangeEnd} onChange={(event) => setRangeEnd(Number(event.target.value))} /></label><button className="secondary-button" onClick={addInternalCut}>Eliminar tramo</button></div><div className="cut-range-list">{removedRanges.length ? removedRanges.map((range, index) => <span key={`${range.start}-${range.end}-${index}`}>{range.start.toFixed(1)}–{range.end.toFixed(1)} s <button onClick={() => setRemovedRanges((old) => old.filter((_item, i) => i !== index))}>×</button></span>) : <small>Sin cortes internos.</small>}</div></div><div className="cut-summary"><span>Original: {formatTime(cutTake.durationMs)}</span><span>Salida estimada: {formatTime(cleanedDurationSeconds(Number(trimStart) || 0, Number(trimEnd) || 0, removedRanges) * 1000)}</span><span>{cutTake.cleanedBlob ? `Limpia: ${formatBytes(cutTake.cleanedBlob.size)}` : 'Sin versión limpia'}</span></div><button className="primary-button" onClick={applyCut} disabled={cutting || audioPreviewBusy}>{cutting ? 'Procesando · ' + (cutProgress > 0 ? Math.round(cutProgress * 100) + '%' : processElapsed + ' s') : 'Guardar corte limpio'}</button></> : <div className="empty-state">Selecciona una diapositiva grabada y aceptada.</div>}</div>
            </div>
            {showCutResult && cutTake?.cleanedBlob && <div className="cut-result-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCutResult(false); }}><section className="cut-result-dialog" role="dialog" aria-modal="true" aria-label="Vista previa del corte procesado" onKeyDown={(event) => { if (event.key === 'Escape') setShowCutResult(false); }}><div className="cut-result-dialog-header"><strong>Resultado procesado · Escena {cutSlide?.number}</strong><button type="button" onClick={() => setShowCutResult(false)} autoFocus>Cerrar ×</button></div>{cutTake.mode === 'audio' ? <audio controls autoPlay src={cutResultUrl} /> : <video controls autoPlay playsInline src={cutResultUrl} />}<p>Esta es la versión limpia guardada. La grabación original sigue intacta.</p></section></div>}
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
