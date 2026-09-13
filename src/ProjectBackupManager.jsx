import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getActiveProject,
  getProjectTakes,
  getTemplatePreferences,
  saveProject,
  saveSlideTake,
  setActiveProject,
  setTemplatePreferences,
} from './storage';
import {
  addVisualFiles,
  getVisualSettings,
  listVisualAssets,
  setVisualSettings,
} from './visualStore';
import './project-backup.css';

const MAGIC = 'VIDEOSSTUDIO_BACKUP_V1';

function formatBytes(bytes = 0) {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function safeFileName(value = 'proyecto') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'proyecto';
}

function uniqueId(base = 'project') {
  return globalThis.crypto?.randomUUID?.() || `${base}-restored-${Date.now()}`;
}

async function buildBackup(project) {
  const takes = await getProjectTakes(project.id);
  const entries = [];
  const payloads = [];

  const addBlob = (kind, blob, name) => {
    if (!(blob instanceof Blob) || !blob.size) return '';
    const id = `${kind}-${entries.length + 1}`;
    entries.push({ id, kind, name, size: blob.size, type: blob.type || 'application/octet-stream' });
    payloads.push(blob);
    return id;
  };

  const takeManifest = takes.map((take) => {
    const {
      blob,
      cleanedBlob,
      key: _key,
      projectId: _projectId,
      ...meta
    } = take;
    return {
      ...meta,
      blobRef: addBlob('take-original', blob, `slide-${take.slideNumber}-original`),
      cleanedBlobRef: addBlob('take-cleaned', cleanedBlob, `slide-${take.slideNumber}-cleaned`),
    };
  });

  const visualManifest = [];
  const visualSettings = {};
  for (const slide of project.slides || []) {
    const [assets, settings] = await Promise.all([
      listVisualAssets(project.id, slide.number),
      getVisualSettings(project.id, slide.number),
    ]);
    visualSettings[slide.number] = settings;
    for (const asset of assets) {
      visualManifest.push({
        slideNumber: slide.number,
        name: asset.name,
        type: asset.type,
        order: asset.order,
        blobRef: addBlob('visual', asset.blob, asset.name),
      });
    }
  }

  const templatePreferences = await getTemplatePreferences(project.id);
  const header = {
    format: MAGIC,
    version: 1,
    createdAt: new Date().toISOString(),
    project,
    takes: takeManifest,
    visuals: visualManifest,
    visualSettings,
    templatePreferences,
    entries,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const prefix = `${MAGIC}\n${headerBytes.length}\n`;
  return new Blob([prefix, headerBytes, ...payloads], { type: 'application/octet-stream' });
}

async function parseBackup(file) {
  const prefixText = await file.slice(0, 256).text();
  const firstBreak = prefixText.indexOf('\n');
  const secondBreak = prefixText.indexOf('\n', firstBreak + 1);
  if (firstBreak < 0 || secondBreak < 0) throw new Error('El archivo de respaldo no es válido.');
  if (prefixText.slice(0, firstBreak) !== MAGIC) throw new Error('Este archivo no pertenece a Videos Studio.');
  const headerLength = Number(prefixText.slice(firstBreak + 1, secondBreak));
  if (!Number.isFinite(headerLength) || headerLength <= 0 || headerLength > 20_000_000) {
    throw new Error('La cabecera del respaldo está dañada.');
  }
  const headerStart = secondBreak + 1;
  const headerEnd = headerStart + headerLength;
  const header = JSON.parse(await file.slice(headerStart, headerEnd).text());
  if (header?.format !== MAGIC || header?.version !== 1 || !header?.project?.slides) {
    throw new Error('Versión de respaldo no compatible.');
  }

  let offset = headerEnd;
  const entryMap = new Map();
  for (const entry of header.entries || []) {
    const size = Number(entry.size) || 0;
    entryMap.set(entry.id, {
      ...entry,
      start: offset,
      end: offset + size,
    });
    offset += size;
  }
  if (offset > file.size) throw new Error('El respaldo está incompleto.');

  const getBlob = (ref) => {
    if (!ref) return null;
    const entry = entryMap.get(ref);
    if (!entry) throw new Error(`Falta un recurso del respaldo: ${ref}`);
    return file.slice(entry.start, entry.end, entry.type || 'application/octet-stream');
  };

  return { header, getBlob };
}

export default function ProjectBackupManager() {
  const [target, setTarget] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [storageInfo, setStorageInfo] = useState(null);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    const sync = () => setTarget(document.querySelector('.project-command-actions'));
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    navigator.storage?.estimate?.().then((value) => setStorageInfo(value)).catch(() => setStorageInfo(null));
  }, [open]);

  async function exportBackup() {
    if (busy) return;
    setBusy(true);
    setMessage('Preparando respaldo…');
    try {
      const project = await getActiveProject();
      if (!project?.id) throw new Error('No hay un proyecto activo para respaldar.');
      const blob = await buildBackup(project);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFileName(project.name)}.vstudio`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setMessage(`Respaldo creado · ${formatBytes(blob.size)}. Incluye proyecto, tomas, cortes e imágenes.`);
    } catch (caught) {
      console.error(caught);
      setMessage(caught?.message || 'No se pudo crear el respaldo.');
    } finally {
      setBusy(false);
    }
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setBusy(true);
    setMessage('Restaurando respaldo…');
    try {
      const { header, getBlob } = await parseBackup(file);
      const newProjectId = uniqueId(header.project.id);
      const restoredProject = {
        ...header.project,
        id: newProjectId,
        name: `${header.project.name || 'Proyecto'} (restaurado)`,
        updatedAt: Date.now(),
      };
      await saveProject(restoredProject);

      for (const take of header.takes || []) {
        const { blobRef, cleanedBlobRef, key: _key, projectId: _projectId, ...meta } = take;
        await saveSlideTake(newProjectId, Number(take.slideNumber), {
          ...meta,
          projectId: newProjectId,
          blob: getBlob(blobRef),
          cleanedBlob: getBlob(cleanedBlobRef),
        });
      }

      const visuals = [...(header.visuals || [])].sort((a, b) => (a.slideNumber - b.slideNumber) || (a.order - b.order));
      for (const visual of visuals) {
        const blob = getBlob(visual.blobRef);
        const fileObject = new File([blob], visual.name || 'imagen', { type: visual.type || blob.type || 'image/jpeg' });
        await addVisualFiles(newProjectId, Number(visual.slideNumber), [fileObject]);
      }
      for (const [slideNumber, settings] of Object.entries(header.visualSettings || {})) {
        await setVisualSettings(newProjectId, Number(slideNumber), settings);
      }
      if (header.templatePreferences) {
        await setTemplatePreferences(newProjectId, header.templatePreferences);
      }
      await setActiveProject(newProjectId);
      setMessage('Respaldo restaurado. Abriendo el proyecto…');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (caught) {
      console.error(caught);
      setMessage(caught?.message || 'No se pudo restaurar el respaldo.');
      setBusy(false);
    }
  }

  const button = target ? createPortal(
    <button type="button" onClick={() => setOpen(true)} disabled={busy}>Respaldo</button>,
    target,
  ) : null;

  const modal = open ? createPortal(
    <div className="backup-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) setOpen(false);
    }}>
      <section className="backup-modal" role="dialog" aria-modal="true" aria-label="Respaldo de proyecto">
        <header>
          <div>
            <span className="eyebrow">SEGURIDAD DEL PROYECTO</span>
            <h2>Respaldo</h2>
            <p>Guarda una copia transportable del proyecto antes de continuar con ediciones grandes.</p>
          </div>
          <button onClick={() => setOpen(false)} disabled={busy} aria-label="Cerrar">×</button>
        </header>

        {storageInfo && (
          <div className="backup-storage">
            <span>Espacio local usado</span>
            <strong>{formatBytes(storageInfo.usage || 0)}</strong>
            <small>Cuota disponible: {formatBytes(storageInfo.quota || 0)}</small>
          </div>
        )}

        <div className="backup-actions">
          <button className="primary-button" onClick={exportBackup} disabled={busy}>Exportar proyecto</button>
          <label className="backup-import-button">
            Importar respaldo
            <input type="file" accept=".vstudio,application/octet-stream" onChange={importBackup} disabled={busy} />
          </label>
        </div>

        <small className="backup-note">El respaldo incluye guion, estado del proyecto, grabaciones, cortes e imágenes cargadas. Los videos globales de Biblioteca permanecen en la carpeta local de Videos Studio y no se duplican dentro del respaldo.</small>
        {message && <div className="backup-message">{message}</div>}
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{button}{modal}</>;
}
