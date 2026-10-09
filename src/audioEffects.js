export const DEFAULT_AUDIO_EFFECTS = Object.freeze({
  noiseReduction: false,
  voiceEnhancement: false,
});

export function normalizeAudioEffects(value = {}) {
  return {
    noiseReduction: value?.noiseReduction === true,
    voiceEnhancement: value?.voiceEnhancement === true,
  };
}

export function hasAudioEffects(value) {
  const effects = normalizeAudioEffects(value);
  return effects.noiseReduction || effects.voiceEnhancement;
}

export function audioFilterChain(value) {
  const effects = normalizeAudioEffects(value);
  const filters = [];
  if (effects.noiseReduction) filters.push('highpass=f=75', 'afftdn=nr=10:nf=-35');
  if (effects.voiceEnhancement) filters.push(
    'highpass=f=85',
    'equalizer=f=2600:t=q:w=1:g=2',
    'acompressor=threshold=0.125:ratio=2.2:attack=15:release=160:makeup=1.3',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  );
  return filters.join(',');
}
