import { useEffect, useMemo, useRef, useState } from 'react';
import { getActiveProject, getProjectTakes, saveProject } from './storage';
import {
  addVisualFiles,
  deleteVisualAsset,
  getVisualSettings,
  listVisualAssets,
  pruneVisualAssets,
  reorderVisualAssets,
  setVisualSettings,
} from './visualStore';
import { activeVisualIndex, buildAutomaticTimeline, formatTimelineSeconds } from './visualTimeline';

function dispatchVisualChange(projectId, slideNumber) {
  window.dispatchEvent(new CustomEvent('videosstudio:visuals-changed', {
    detail: { projectId, slideNumber },
  }));
}

function useAssetUrls(assets) {
  const [urls, setUrls] = useState({});
  useEffect(() => {
    const next = {};
    const created = [];
    assets.forEach((asset) => {
      if (!asset?.blob) return;
      const url = URL.createObjectURL(asset.blob);
      next[asset.id] = url;
      created.push(url);
    });
    setUrls(next);
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, [assets]);
  return urls;
}

function sameRect(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return ['left', 'top', 'width', 'height'].every((key) => Math.abs((a[key] || 0) - (b[key] || 0)) < 0.5);
}

export default function VisualManager() {
  const [visible, setVisible] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeSlide, setActiveSlide] = useState(null);
  const [project, setProject] = useState(null);
  const [take, setTake] = useState(null);
  const [assets, setAssets] = useState([]);
  const [settings, setSettings] = useState({ fit: 'cover', transition: 'fade' });
  const [mediaTime, setMediaTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [sceneRect, setSceneRect] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const urls = useAssetUrls(assets);

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
        if (!nextVisible) {
          setActiveSlide(null);
          setSceneRect(null);
          return;
        }
        const slideNumber = Number(document.querySelector('.join-scene-list button.active > span')?.textContent || 0);
        setActiveSlide(slideNumber || null);
        const visual = document.querySelector('.scene-visual');
        if (!visual) {
          setSceneRect(null);
          return;
        }
        const rect = visual.getBoundingClientRect();
        const nextRect = rect.width > 20 && rect.height > 20
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : null;
        setSceneRect((current) => sameRect(current, nextRect) ? current : nextRect);
      });
    };

    const observer = new MutationObserver(sync);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
    root.addEventListener('click', sync, true);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    sync();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener('click', sync, true);
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const closeWhenTemplateOpens = (event) => {
      if (event.target?.closest?.('.template-current-button, .template-upload-button')) setDrawerOpen(false);
    };
    document.addEventListener('click', closeWhenTemplateOpens, true);
    return () => document.removeEventListener('click', closeWhenTemplateOpens, true);
  }, [visible]);

  async function loadSceneData(slideNumber = activeSlide) {
    if (!visible || !slideNumber) return;
    const active = await getActiveProject();
    if (!active?.id) return;
    setProject(active);
    await pruneVisualAssets(active.id, (active.slides || []).map((slide) => slide.number));
    const [rows, sceneSettings, takes] = await Promise.all([
      listVisualAssets(active.id, slideNumber),
      getVisualSettings(active.id, slideNumber),
      getProjectTakes(active.id),
    ]);
    setAssets(rows);
    setSettings(sceneSettings);
    setTake(takes.find((row) => Number(row.slideNumber) === Number(slideNumber)) || null);
  }

  useEffect(() => {
    if (!visible || !activeSlide) return;
    loadSceneData(activeSlide).catch((caught) => setError(caught.message || 'No se pudieron cargar los visuales.'));
  }, [visible, activeSlide]);

  useEffect(() => {
    const onVisualChange = (event) => {
      if (!visible || !activeSlide) return;
      if (event.detail?.slideNumber && Number(event.detail.slideNumber) !== Number(activeSlide)) return;
      loadSceneData(activeSlide).catch(() => {});
    };
    window.addEventListener('videosstudio:visuals-changed', onVisualChange);
    return () => window.removeEventListener('videosstudio:visuals-changed', onVisualChange);
  }, [visible, activeSlide]);

  useEffect(() => {
    if (!visible) return undefined;
    let media = null;
    let interval = 0;
    const bind = () => {
      const next = document.querySelector('.scene-presenter video, .scene-presenter audio');
      if (media === next) return;
      if (media) {
        ['timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'ended'].forEach((name) => media.removeEventListener(name, sync));
      }
      media = next;
      if (media) {
        ['timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'ended'].forEach((name) => media.addEventListener(name, sync));
        sync();
      }
    };
    const sync = () => {
      if (!media) return;
      setMediaTime(Number.isFinite(media.currentTime) ? media.currentTime : 0);
      if (Number.isFinite(media.duration) && media.duration > 0) setMediaDuration(media.duration);
    };
    bind();
    interval = window.setInterval(() => {
      bind();
      if (media && !media.paused) sync();
    }, 250);
    return () => {
      window.clearInterval(interval);
      if (media) ['timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'ended'].forEach((name) => media.removeEventListener(name, sync));
    };
  }, [visible, activeSlide]);

  useEffect(() => {
    const visual = document.querySelector('.scene-visual');
    if (!visual) return;
    visual.classList.toggle('has-uploaded-visual', assets.length > 0);
    return () => visual.classList.remove('has-uploaded-visual');
  }, [visible, activeSlide, assets.length]);

  const durationSeconds = useMemo(() => {
    const stored = Number(take?.cleanedDurationMs || take?.durationMs || 0) / 1000;
    return mediaDuration > 0 ? mediaDuration : stored;
  }, [take, mediaDuration]);

  const timeline = useMemo(
    () => buildAutomaticTimeline(durationSeconds, assets),
    [durationSeconds, assets],
  );

  const currentIndex = activeVisualIndex(mediaTime, durationSeconds, assets.length);
  const currentAsset = currentIndex >= 0 ? assets[currentIndex] : null;
  const currentUrl = currentAsset ? urls[currentAsset.id] : '';
  const secondsPerImage = assets.length && durationSeconds ? durationSeconds / assets.length : 0;

  async function invalidateMountedScene() {
    const active = await getActiveProject();
    if (!active?.id || !activeSlide || !active.productionPlan?.scenes?.[activeSlide]?.ready) return;
    const scenes = { ...(active.productionPlan.scenes || {}) };
    scenes[activeSlide] = { ...scenes[activeSlide], ready: false, updatedAt: Date.now() };
    await saveProject({
      ...active,
      productionPlan: { ...(active.productionPlan || {}), scenes },
      updatedAt: Date.now(),
    });
    window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
  }

  function openDrawer() {
    document.querySelector('.template-drawer .template-close')?.click();
    setDrawerOpen(true);
    setError('');
  }

  async function importImages(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || !project?.id || !activeSlide) return;
    const unsupported = files.filter((file) => !String(file.type || '').startsWith('image/'));
    const accepted = files.filter((file) => String(file.type || '').startsWith('image/'));
    if (!accepted.length) {
      setError('Selecciona archivos de imagen válidos.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await addVisualFiles(project.id, activeSlide, accepted);
      await invalidateMountedScene();
      await loadSceneData(activeSlide);
      dispatchVisualChange(project.id, activeSlide);
      setNotice(`${accepted.length} imagen${accepted.length === 1 ? '' : 'es'} agregada${accepted.length === 1 ? '' : 's'}. El tiempo se distribuirá automáticamente.`);
      if (unsupported.length) setNotice((value) => `${value} ${unsupported.length} archivo(s) no compatible(s) se omitieron.`);
      setDrawerOpen(true);
    } catch (caught) {
      setError(caught.message || 'No se pudieron guardar las imágenes.');
    } finally {
      setBusy(false);
    }
  }

  async function removeAsset(asset) {
    if (!project?.id || !activeSlide) return;
    setBusy(true);
    try {
      await deleteVisualAsset(asset.id);
      await invalidateMountedScene();
      await loadSceneData(activeSlide);
      dispatchVisualChange(project.id, activeSlide);
      setNotice('Imagen eliminada. La secuencia se redistribuyó automáticamente.');
    } catch (caught) {
      setError(caught.message || 'No se pudo eliminar la imagen.');
    } finally {
      setBusy(false);
    }
  }

  async function moveAsset(index, delta) {
    const target = index + delta;
    if (!project?.id || !activeSlide || target < 0 || target >= assets.length) return;
    const next = [...assets];
    [next[index], next[target]] = [next[target], next[index]];
    setAssets(next.map((row, order) => ({ ...row, order: order + 1 })));
    try {
      await reorderVisualAssets(project.id, activeSlide, next.map((row) => row.id));
      await invalidateMountedScene();
      dispatchVisualChange(project.id, activeSlide);
    } catch (caught) {
      setError(caught.message || 'No se pudo cambiar el orden.');
      await loadSceneData(activeSlide);
    }
  }

  async function updateSettings(patch) {
    if (!project?.id || !activeSlide) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await setVisualSettings(project.id, activeSlide, next);
      await invalidateMountedScene();
      dispatchVisualChange(project.id, activeSlide);
    } catch (caught) {
      setError(caught.message || 'No se pudo guardar el ajuste visual.');
    }
  }

  if (!visible || !project || !activeSlide) return null;

  return (
    <>
      <input
        ref={fileInputRef}
        className="visual-hidden-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        onChange={importImages}
      />

      <div className="visual-manager-dock">
        <button className="visual-current-button" onClick={openDrawer}>
          <span className={`visual-dock-icon ${assets.length ? 'ready' : ''}`}>{assets.length || '+'}</span>
          <span>
            <small>Visual · diap. {activeSlide}</small>
            <strong>{assets.length ? `${assets.length} imagen${assets.length === 1 ? '' : 'es'} · automático` : 'Añadir imágenes'}</strong>
          </span>
        </button>
        <button className="visual-quick-add" onClick={() => fileInputRef.current?.click()} disabled={busy}>+ Imágenes</button>
      </div>

      {sceneRect && (
        <div
          className={`scene-visual-overlay ${assets.length ? 'with-media' : 'empty'} transition-${settings.transition}`}
          style={{ left: sceneRect.left, top: sceneRect.top, width: sceneRect.width, height: sceneRect.height }}
        >
          {currentUrl ? (
            <img key={`${currentAsset.id}-${currentIndex}`} src={currentUrl} alt={currentAsset.name} style={{ objectFit: settings.fit }} />
          ) : (
            <button className="scene-visual-empty-action" onClick={() => fileInputRef.current?.click()}>
              <span>+</span>
              <strong>Agregar imagen</strong>
              <small>Una o varias</small>
            </button>
          )}
          {assets.length > 0 && (
            <button className="scene-visual-edit" onClick={openDrawer} title="Editar imágenes">
              {currentIndex + 1}/{assets.length} · Editar
            </button>
          )}
        </div>
      )}

      {drawerOpen && (
        <aside className="visual-drawer">
          <div className="visual-drawer-header">
            <div>
              <small>DIAPOSITIVA {activeSlide} · VISUAL</small>
              <h2>Imágenes de la escena</h2>
              <p>Sube una o varias imágenes. Videos Studio reparte automáticamente la duración de la escena entre ellas.</p>
            </div>
            <button className="visual-close" onClick={() => setDrawerOpen(false)} aria-label="Cerrar">×</button>
          </div>

          <div className="visual-summary">
            <div><strong>{assets.length}</strong><span>imágenes</span></div>
            <div><strong>{durationSeconds ? formatTimelineSeconds(durationSeconds) : '—'}</strong><span>duración escena</span></div>
            <div><strong>{secondsPerImage ? formatTimelineSeconds(secondsPerImage) : '—'}</strong><span>por imagen</span></div>
          </div>

          <div className="visual-controls-row">
            <label>
              <span>Ajuste</span>
              <select value={settings.fit} onChange={(event) => updateSettings({ fit: event.target.value })}>
                <option value="cover">Rellenar área</option>
                <option value="contain">Mostrar completa</option>
              </select>
            </label>
            <label>
              <span>Cambio</span>
              <select value={settings.transition} onChange={(event) => updateSettings({ transition: event.target.value })}>
                <option value="fade">Fade suave</option>
                <option value="cut">Corte directo</option>
              </select>
            </label>
          </div>

          <button className="visual-primary" onClick={() => fileInputRef.current?.click()} disabled={busy}>+ Subir una o varias imágenes</button>

          {(notice || error) && (
            <div className={`visual-message ${error ? 'error' : 'success'}`}>
              <span>{error || notice}</span>
              <button onClick={() => { setNotice(''); setError(''); }}>×</button>
            </div>
          )}

          <div className="visual-assets-list">
            {assets.length ? assets.map((asset, index) => {
              const item = timeline[index];
              return (
                <article className="visual-asset-card" key={asset.id}>
                  <div className="visual-thumb"><img src={urls[asset.id] || ''} alt={asset.name} /></div>
                  <div className="visual-asset-info">
                    <strong>{index + 1}. {asset.name}</strong>
                    <span>{durationSeconds ? `${formatTimelineSeconds(item?.start)} → ${formatTimelineSeconds(item?.end)}` : 'Se calculará al tener duración de escena'}</span>
                  </div>
                  <div className="visual-asset-actions">
                    <button onClick={() => moveAsset(index, -1)} disabled={busy || index === 0} title="Mover antes">↑</button>
                    <button onClick={() => moveAsset(index, 1)} disabled={busy || index === assets.length - 1} title="Mover después">↓</button>
                    <button className="danger" onClick={() => removeAsset(asset)} disabled={busy} title="Eliminar">×</button>
                  </div>
                </article>
              );
            }) : (
              <div className="visual-empty-state">
                <span className="visual-empty-icon">▧</span>
                <strong>Todavía no hay imágenes</strong>
                <p>Si subes una, permanecerá toda la escena. Si subes varias, cambiarán automáticamente durante el video.</p>
                <button className="visual-primary" onClick={() => fileInputRef.current?.click()}>Seleccionar imágenes</button>
              </div>
            )}
          </div>

          <div className="visual-auto-note">
            <strong>Automático</strong>
            <span>{assets.length <= 1 ? 'La imagen ocupa toda la duración de la escena.' : `Las ${assets.length} imágenes se reparten en partes iguales y siguen el tiempo del video.`}</span>
          </div>
        </aside>
      )}
    </>
  );
}
