import { useEffect, useMemo, useState } from 'react';
import {
  getActiveProject,
  getTemplateMetadataMap,
  getTemplatePreferences,
  setTemplateMetadataMap,
  setTemplatePreferences,
} from './storage';

const TEMPLATE_CATEGORY = 'templates';
const ACCENT_LABELS = {
  all: 'Todos',
  gold: 'Dorados',
  green: 'Verdes',
  blue: 'Azules',
  other: 'Otros',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildZones(dividerX = 0.56, dividerY = 0.47) {
  const x = clamp(dividerX, 0.48, 0.68);
  const y = clamp(dividerY, 0.32, 0.62);
  const rightX = clamp(x + 0.025, 0.51, 0.72);
  const rightWidth = clamp(0.94 - rightX, 0.20, 0.43);

  return {
    visual: {
      x: 0.06,
      y: 0.11,
      w: clamp(x - 0.08, 0.38, 0.58),
      h: 0.74,
    },
    data: {
      x: rightX,
      y: 0.18,
      w: rightWidth,
      h: clamp(y - 0.21, 0.12, 0.34),
    },
    video: {
      x: rightX,
      y: clamp(y + 0.025, 0.36, 0.66),
      w: rightWidth,
      h: clamp(0.84 - (y + 0.025), 0.18, 0.46),
    },
  };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo analizar la imagen.'));
    image.src = dataUrl;
  });
}

function detectAccent(data, fileName = '') {
  const normalizedName = fileName.toLowerCase();
  if (/dorado|gold/.test(normalizedName)) return 'gold';
  if (/verde|green/.test(normalizedName)) return 'green';
  if (/azul|blue/.test(normalizedName)) return 'blue';

  const counts = { gold: 0, green: 0, blue: 0 };
  for (let index = 0; index < data.length; index += 16) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    if (max < 70 || max - min < 28) continue;

    if (green > red * 1.12 && green > blue * 1.12) counts.green += 1;
    else if (red > 115 && green > 75 && red > blue * 1.45 && green > blue * 1.3) counts.gold += 1;
    else if (blue > red * 1.12 && blue >= green * 0.95) counts.blue += 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] > 5 ? sorted[0][0] : 'other';
}

function detectDividers(data, width, height) {
  const gray = (x, y) => {
    const index = (y * width + x) * 4;
    return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  };

  let bestX = Math.round(width * 0.56);
  let bestXScore = 0;
  const xStart = Math.round(width * 0.46);
  const xEnd = Math.round(width * 0.70);
  const yStart = Math.round(height * 0.08);
  const yEnd = Math.round(height * 0.88);

  for (let x = xStart; x <= xEnd; x += 1) {
    let score = 0;
    let samples = 0;
    for (let y = yStart; y <= yEnd; y += 2) {
      score += Math.abs(gray(x, y) - gray(Math.max(0, x - 2), y));
      samples += 1;
    }
    score /= Math.max(samples, 1);
    if (score > bestXScore) {
      bestXScore = score;
      bestX = x;
    }
  }

  let bestY = Math.round(height * 0.47);
  let bestYScore = 0;
  const rightStart = clamp(bestX + 4, 0, width - 1);
  const rightEnd = Math.round(width * 0.95);
  const horizontalStart = Math.round(height * 0.29);
  const horizontalEnd = Math.round(height * 0.65);

  for (let y = horizontalStart; y <= horizontalEnd; y += 1) {
    let score = 0;
    let samples = 0;
    for (let x = rightStart; x <= rightEnd; x += 2) {
      score += Math.abs(gray(x, y) - gray(x, Math.max(0, y - 2)));
      samples += 1;
    }
    score /= Math.max(samples, 1);
    if (score > bestYScore) {
      bestYScore = score;
      bestY = y;
    }
  }

  return {
    dividerX: clamp(bestX / width, 0.48, 0.68),
    dividerY: clamp(bestY / height, 0.32, 0.62),
    edgeScore: Math.min(bestXScore, bestYScore),
  };
}

async function analyzeTemplate(dataUrl, name) {
  const image = await loadImage(dataUrl);
  const sampleWidth = 320;
  const sampleHeight = 180;
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const detected = detectDividers(pixels, sampleWidth, sampleHeight);
  const ratio = image.width / Math.max(image.height, 1);
  const aspect16x9 = Math.abs(ratio - 16 / 9) <= 0.035;
  const confidence = detected.edgeScore >= 17 && aspect16x9 ? 'high' : detected.edgeScore >= 9 ? 'medium' : 'low';

  return {
    width: image.width,
    height: image.height,
    aspect16x9,
    accent: detectAccent(pixels, name),
    layout: '3-zonas',
    dividerX: detected.dividerX,
    dividerY: detected.dividerY,
    zones: buildZones(detected.dividerX, detected.dividerY),
    confidence,
    analyzedAt: Date.now(),
  };
}

function percent(value) {
  return `${(Number(value) * 100).toFixed(3)}%`;
}

function confidenceLabel(value) {
  if (value === 'high') return 'Alta';
  if (value === 'medium') return 'Media';
  if (value === 'manual') return 'Ajustada';
  return 'Baja';
}

export default function TemplateManager() {
  const [visible, setVisible] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSlide, setActiveSlide] = useState(null);
  const [project, setProject] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [preferences, setPreferences] = useState({ defaultPath: '', perSlide: {} });
  const [metadataMap, setMetadataMap] = useState({});
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [adjustingPath, setAdjustingPath] = useState('');

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    let frame = 0;

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const join = document.querySelector('.join-flow');
        const nextVisible = Boolean(join);
        setVisible(nextVisible);
        if (!nextVisible) return;
        const slideNumber = Number(document.querySelector('.join-scene-list button.active > span')?.textContent || 0);
        setActiveSlide(slideNumber || null);
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    root.addEventListener('click', sync, true);
    sync();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener('click', sync, true);
    };
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    getActiveProject()
      .then(async (activeProject) => {
        if (cancelled) return;
        setProject(activeProject);
        if (!activeProject?.id) {
          setPreferences({ defaultPath: '', perSlide: {} });
          return;
        }
        const saved = await getTemplatePreferences(activeProject.id);
        if (!cancelled) setPreferences(saved);
      })
      .catch((caught) => !cancelled && setError(caught.message || 'No se pudo leer el proyecto activo.'));
    return () => {
      cancelled = true;
    };
  }, [visible]);

  async function refreshTemplates() {
    const api = window.videosStudio?.library;
    if (!api?.listMedia || !api?.readDataUrl) {
      setError('Las plantillas de fondo necesitan la aplicación de escritorio Electron.');
      return;
    }

    const [items, savedMetadata] = await Promise.all([
      api.listMedia({ scope: 'global', category: TEMPLATE_CATEGORY }),
      getTemplateMetadataMap(),
    ]);
    const nextMetadata = { ...savedMetadata };

    const enriched = await Promise.all(
      items.map(async (item) => {
        const dataUrl = await api.readDataUrl({ path: item.path });
        let metadata = nextMetadata[item.path];
        if (!metadata) {
          metadata = await analyzeTemplate(dataUrl, item.name);
          nextMetadata[item.path] = metadata;
        }
        return { ...item, dataUrl, metadata };
      }),
    );

    setMetadataMap(nextMetadata);
    setTemplates(enriched);
    await setTemplateMetadataMap(nextMetadata);
  }

  useEffect(() => {
    if (!visible) return;
    refreshTemplates().catch((caught) => setError(caught.message || 'No se pudieron cargar las plantillas.'));
  }, [visible]);

  const effectivePath = useMemo(() => {
    if (activeSlide && preferences.perSlide?.[activeSlide]) return preferences.perSlide[activeSlide];
    return preferences.defaultPath || '';
  }, [activeSlide, preferences]);

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.path === effectivePath) || null,
    [templates, effectivePath],
  );

  const filteredTemplates = useMemo(
    () => templates.filter((item) => filter === 'all' || (item.metadata?.accent || 'other') === filter),
    [templates, filter],
  );

  useEffect(() => {
    const composer = document.querySelector('.scene-composer');
    if (!visible || !composer || !selectedTemplate?.dataUrl || !selectedTemplate.metadata?.zones) {
      if (composer) {
        composer.classList.remove('template-active');
        composer.style.removeProperty('--template-image');
        composer.style.backgroundImage = '';
      }
      return;
    }

    const { zones } = selectedTemplate.metadata;
    composer.classList.add('template-active');
    composer.style.backgroundImage = `url(${JSON.stringify(selectedTemplate.dataUrl)})`;
    for (const [zoneName, zone] of Object.entries(zones)) {
      composer.style.setProperty(`--${zoneName}-x`, percent(zone.x));
      composer.style.setProperty(`--${zoneName}-y`, percent(zone.y));
      composer.style.setProperty(`--${zoneName}-w`, percent(zone.w));
      composer.style.setProperty(`--${zoneName}-h`, percent(zone.h));
    }
  }, [visible, selectedTemplate, activeSlide]);

  async function persistPreferences(next) {
    setPreferences(next);
    if (project?.id) await setTemplatePreferences(project.id, next);
  }

  async function selectDefault(path) {
    await persistPreferences({ ...preferences, defaultPath: path });
    setNotice('Plantilla predeterminada actualizada.');
  }

  async function selectForSlide(path) {
    if (!activeSlide) return;
    await persistPreferences({
      ...preferences,
      perSlide: { ...preferences.perSlide, [activeSlide]: path },
    });
    setNotice(`Plantilla asignada a la diapositiva ${activeSlide}.`);
  }

  async function clearSlideOverride() {
    if (!activeSlide) return;
    const perSlide = { ...preferences.perSlide };
    delete perSlide[activeSlide];
    await persistPreferences({ ...preferences, perSlide });
    setNotice(`La diapositiva ${activeSlide} vuelve a usar el fondo predeterminado.`);
  }

  async function uploadTemplates() {
    const api = window.videosStudio?.library;
    if (!api?.importMedia) return setError('No se puede abrir el selector de archivos.');
    setBusy(true);
    setError('');
    try {
      const imported = await api.importMedia({ scope: 'global', category: TEMPLATE_CATEGORY });
      if (imported?.length) {
        setNotice(`${imported.length} fondo${imported.length === 1 ? '' : 's'} agregado${imported.length === 1 ? '' : 's'} y analizado${imported.length === 1 ? '' : 's'}.`);
        await refreshTemplates();
        setDrawerOpen(true);
      }
    } catch (caught) {
      setError(caught.message || 'No se pudieron importar los fondos.');
    } finally {
      setBusy(false);
    }
  }

  async function reanalyze(item) {
    setBusy(true);
    setError('');
    try {
      const metadata = await analyzeTemplate(item.dataUrl, item.name);
      const nextMap = { ...metadataMap, [item.path]: metadata };
      setMetadataMap(nextMap);
      setTemplates((current) => current.map((row) => (row.path === item.path ? { ...row, metadata } : row)));
      await setTemplateMetadataMap(nextMap);
      setNotice('Identificación automática actualizada.');
    } catch (caught) {
      setError(caught.message || 'No se pudo volver a analizar esta plantilla.');
    } finally {
      setBusy(false);
    }
  }

  async function adjustDivider(item, axis, rawValue) {
    const current = item.metadata || {};
    const dividerX = axis === 'x' ? Number(rawValue) : Number(current.dividerX || 0.56);
    const dividerY = axis === 'y' ? Number(rawValue) : Number(current.dividerY || 0.47);
    const metadata = {
      ...current,
      dividerX,
      dividerY,
      zones: buildZones(dividerX, dividerY),
      confidence: 'manual',
    };
    const nextMap = { ...metadataMap, [item.path]: metadata };
    setMetadataMap(nextMap);
    setTemplates((currentRows) => currentRows.map((row) => (row.path === item.path ? { ...row, metadata } : row)));
    await setTemplateMetadataMap(nextMap);
  }

  async function deleteTemplate(item) {
    if (!window.confirm(`¿Eliminar el fondo "${item.name}"?`)) return;
    const api = window.videosStudio?.library;
    setBusy(true);
    setError('');
    try {
      await api.deleteMedia({ scope: 'global', category: TEMPLATE_CATEGORY, path: item.path });
      const nextMap = { ...metadataMap };
      delete nextMap[item.path];
      await setTemplateMetadataMap(nextMap);
      setMetadataMap(nextMap);

      const perSlide = Object.fromEntries(
        Object.entries(preferences.perSlide || {}).filter(([, path]) => path !== item.path),
      );
      const nextPreferences = {
        defaultPath: preferences.defaultPath === item.path ? '' : preferences.defaultPath,
        perSlide,
      };
      await persistPreferences(nextPreferences);
      await refreshTemplates();
      setNotice('Fondo eliminado.');
    } catch (caught) {
      setError(caught.message || 'No se pudo eliminar el fondo.');
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <>
      <div className="template-manager-dock" aria-label="Plantillas de fondo">
        <button className="template-current-button" onClick={() => setDrawerOpen(true)}>
          {selectedTemplate?.dataUrl ? <img src={selectedTemplate.dataUrl} alt="" /> : <span className="template-empty-thumb">16:9</span>}
          <span>
            <small>Fondo de escena</small>
            <strong>{selectedTemplate?.name || 'Sin plantilla'}</strong>
          </span>
        </button>
        <button className="template-upload-button" onClick={uploadTemplates} disabled={busy}>+ Subir fondos</button>
      </div>

      {drawerOpen && (
        <aside className="template-drawer">
          <div className="template-drawer-header">
            <div>
              <small>UNIÓN · FONDOS</small>
              <h2>Plantillas de escena</h2>
              <p>Sube PNG, JPG o WEBP. Videos Studio identifica color y zonas automáticamente.</p>
            </div>
            <button className="template-close" onClick={() => setDrawerOpen(false)} aria-label="Cerrar">×</button>
          </div>

          <div className="template-drawer-actions">
            <button className="template-primary" onClick={uploadTemplates} disabled={busy}>+ Subir imágenes</button>
            {activeSlide && preferences.perSlide?.[activeSlide] && (
              <button onClick={clearSlideOverride}>Usar predeterminada en diap. {activeSlide}</button>
            )}
          </div>

          <div className="template-filters">
            {Object.entries(ACCENT_LABELS).map(([key, label]) => (
              <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>

          {(notice || error) && (
            <div className={`template-message ${error ? 'error' : 'success'}`}>
              {error || notice}
              <button onClick={() => { setError(''); setNotice(''); }}>×</button>
            </div>
          )}

          <div className="template-gallery">
            {filteredTemplates.length ? filteredTemplates.map((item) => {
              const meta = item.metadata || {};
              const isDefault = preferences.defaultPath === item.path;
              const isThisSlide = activeSlide && preferences.perSlide?.[activeSlide] === item.path;
              const isEffective = effectivePath === item.path;
              const adjusting = adjustingPath === item.path;
              return (
                <article key={item.path} className={`template-card ${isEffective ? 'selected' : ''}`}>
                  <button className="template-preview" onClick={() => selectForSlide(item.path)} title={`Usar en diapositiva ${activeSlide || ''}`}>
                    <img src={item.dataUrl} alt={item.name} />
                    {isEffective && <span className="template-selected-badge">EN USO</span>}
                  </button>
                  <div className="template-card-info">
                    <strong title={item.name}>{item.name}</strong>
                    <span>
                      {meta.width || '?'}×{meta.height || '?'} · {meta.aspect16x9 ? '16:9' : 'Revisar proporción'} · {ACCENT_LABELS[meta.accent] || 'Otro'}
                    </span>
                    <span>Layout {meta.layout || 'sin detectar'} · Confianza {confidenceLabel(meta.confidence)}</span>
                  </div>
                  <div className="template-card-actions">
                    <button className={isDefault ? 'active' : ''} onClick={() => selectDefault(item.path)}>{isDefault ? '✓ Predeterminada' : 'Usar siempre'}</button>
                    <button className={isThisSlide ? 'active' : ''} onClick={() => selectForSlide(item.path)}>{isThisSlide ? `✓ Diap. ${activeSlide}` : `Solo diap. ${activeSlide || '—'}`}</button>
                    <button onClick={() => setAdjustingPath(adjusting ? '' : item.path)}>Ajustar</button>
                  </div>
                  {adjusting && (
                    <div className="template-adjustments">
                      <label>
                        <span>División vertical <b>{Math.round((meta.dividerX || 0.56) * 100)}%</b></span>
                        <input type="range" min="0.48" max="0.68" step="0.005" value={meta.dividerX || 0.56} onChange={(event) => adjustDivider(item, 'x', event.target.value)} />
                      </label>
                      <label>
                        <span>División horizontal <b>{Math.round((meta.dividerY || 0.47) * 100)}%</b></span>
                        <input type="range" min="0.32" max="0.62" step="0.005" value={meta.dividerY || 0.47} onChange={(event) => adjustDivider(item, 'y', event.target.value)} />
                      </label>
                      <div>
                        <button onClick={() => reanalyze(item)} disabled={busy}>Reidentificar automáticamente</button>
                        <button className="template-delete" onClick={() => deleteTemplate(item)} disabled={busy}>Eliminar</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            }) : (
              <div className="template-empty-state">
                <strong>No hay fondos en esta categoría.</strong>
                <span>Sube tus diseños 1920 × 1080 y se organizarán automáticamente.</span>
                <button className="template-primary" onClick={uploadTemplates} disabled={busy}>Subir fondos</button>
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
