import { cutMedia, enhanceMediaAudio, createAudioComparison } from './ffmpeg';

function syntheticWav() {
  const rate = 16000;
  const frames = rate * 2;
  const bytes = new ArrayBuffer(44 + frames * 2);
  const dv = new DataView(bytes);
  const ascii = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) dv.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  dv.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i += 1) {
    const signal = Math.sin(2 * Math.PI * 220 * i / rate) * 0.4
      + Math.sin(2 * Math.PI * 60 * i / rate) * 0.05;
    dv.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(signal * 32767))), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

async function syntheticWebM() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error('Chromium no ofrece MediaRecorder/captureStream para validar video.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  const paint = (n) => {
    context.fillStyle = '#1b326b';
    context.fillRect(0, 0, 320, 180);
    context.fillStyle = '#61cabb';
    context.fillRect(20 + (n % 150), 65, 55, 45);
  };
  paint(0);
  const camera = canvas.captureStream(8);
  const audio = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audio.createOscillator();
  oscillator.frequency.value = 250;
  const destination = audio.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  void audio.resume().catch(() => {});
  const stream = new MediaStream([...camera.getVideoTracks(), ...destination.stream.getAudioTracks()]);
  const mime = ['video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) throw new Error('El Chromium de pruebas no soporta WebM.');
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const finished = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = resolve;
    recorder.onerror = (event) => reject(new Error(event.error?.message || 'No se pudo grabar la muestra sintética.'));
  });
  const ticker = setInterval(() => paint(Date.now() % 150), 125);
  try {
    recorder.start(100);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    recorder.stop();
    await finished;
    const blob = new Blob(chunks, { type: mime });
    if (blob.size < 1000) throw new Error('La muestra WebM se generó vacía.');
    return blob;
  } finally {
    clearInterval(ticker);
    if (recorder.state !== 'inactive') recorder.stop();
    oscillator.stop();
    stream.getTracks().forEach((track) => track.stop());
    await audio.close();
  }
}

export async function runAudioSmokeTest() {
  const source = syntheticWav();
  const combined = { noiseReduction: true, voiceEnhancement: true };
  const improved = await enhanceMediaAudio(source, 'audio', combined);
  if (!improved || improved.size < 1000) throw new Error('FFmpeg no produjo el archivo de audio mejorado.');
  const sample = await createAudioComparison(source, 0.1, 0.6, combined);
  if (!sample.original?.size || !sample.improved?.size) throw new Error('Falló la muestra original/mejorada.');
  const cut = await cutMedia(source, 'audio', 0.1, 1.7, [{ start: 0.65, end: 0.8 }], null, {
    noiseReduction: true,
    voiceEnhancement: false,
  });
  if (!cut || cut.size < 500) throw new Error('FFmpeg no produjo el corte con reducción de ruido.');
  const originalVideo = await syntheticWebM();
  const enhancedVideo = await enhanceMediaAudio(originalVideo, 'video', { voiceEnhancement: true });
  if (enhancedVideo.size < 1500 || enhancedVideo.type !== 'video/mp4') {
    throw new Error('La mejora de voz no generó un video MP4 válido.');
  }
  return { improved: improved.size, originalSample: sample.original.size,
    enhancedSample: sample.improved.size, cut: cut.size,
    sourceVideo: originalVideo.size, improvedVideo: enhancedVideo.size };
}
