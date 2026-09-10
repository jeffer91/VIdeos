export function normalizeVisualAssets(assets = []) {
  return [...assets].sort((a, b) => {
    const orderDiff = (Number(a?.order) || 0) - (Number(b?.order) || 0);
    if (orderDiff) return orderDiff;
    return (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0);
  });
}

export function buildAutomaticTimeline(durationSeconds = 0, assets = []) {
  const ordered = normalizeVisualAssets(assets);
  const duration = Math.max(0, Number(durationSeconds) || 0);
  if (!ordered.length) return [];

  if (!duration) {
    return ordered.map((asset, index) => ({
      ...asset,
      index,
      start: 0,
      end: 0,
      duration: 0,
    }));
  }

  const slice = duration / ordered.length;
  return ordered.map((asset, index) => {
    const start = index * slice;
    const end = index === ordered.length - 1 ? duration : (index + 1) * slice;
    return {
      ...asset,
      index,
      start,
      end,
      duration: Math.max(0, end - start),
    };
  });
}

export function activeVisualIndex(currentTime = 0, durationSeconds = 0, count = 0) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (!total) return -1;
  if (total === 1) return 0;

  const duration = Math.max(0, Number(durationSeconds) || 0);
  if (!duration) return 0;

  const time = Math.min(duration, Math.max(0, Number(currentTime) || 0));
  if (time >= duration) return total - 1;
  return Math.min(total - 1, Math.floor((time / duration) * total));
}

export function formatTimelineSeconds(value = 0) {
  const seconds = Math.max(0, Number(value) || 0);
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${seconds.toFixed(0)} s`;
}
