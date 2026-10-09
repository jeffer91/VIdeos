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
  return { improved: improved.size, originalSample: sample.original.size,
    enhancedSample: sample.improved.size, cut: cut.size };
}
