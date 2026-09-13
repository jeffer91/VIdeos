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
const INHERIT = '__inherit__';
const NONE = '__none__';

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

function resolveChoice(value, fallback = '') {
  if (value === NONE) return '';
  if (!value || value === INHERIT) return fallback || '';
  return value;
}

function isActiveCta(cta = '') {
  const normalized = String(cta).toUpperCase();
  return !!normalized && !/TIPO\s*:\s*NINGUNO/.test(normalized) && normalized.trim() !== 'NINGUNO';
}

function buildResolvedAssignments(project, defaults, templatePreferences) {
  const plan = project.productionPlan || {};
  const transitionDefault = resolveChoice(plan.transitionDefault, defaults.transitions || '');
  const transitions = {};
  const ctaAssets = {};
  for (const slide of project.slides || []) {
    transitions[slide.number] = resolveChoice(plan.transitions?.[slide.number], transitionDefault);
    if (isActiveCta(slide.cta)) {
      ctaAssets[slide.number] = resolveChoice(plan.ctaAssets?.[slide.number], defaults.cta || '');
    }
  }
  return {
    intro: resolveChoice(plan.intro, defaults.intros || ''),
    ending: resolveChoice(plan.ending, defaults.endings || ''),
    transitionDefault,
    transitions,
    ctaAssets,
    templates: {
      defaultPath: templatePreferences?.defaultPath || '',
      perSlide: { ...(templatePreferences?.perSlide || {}) },
    },
  };
}

function collectPortableResources(project, assignments) {
  const resources = new Map();
  const add = (category, path) => {
    if (!path) return;
    resources.set(`${category}:${path}`, { category, path });
  };
  add('intros', assignments.intro);
  add('endings', assignments.ending);
  add('transitions', assignments.transitionDefault);
  Object.values(assignments.transitions || {}).forEach((path) => add('transitions', path));
  Object.values(assignments.ctaAssets || {}).forEach((path) => add('cta', path));
  (project.productionPlan?.memes || []).forEach((item) => add('memes', item.assetPath));
  add('templates', assignments.templates?.defaultPath);
  Object.values(assignments.templates?.perSlide || {}).forEach((path) => add('templates', path));
  return [...resources.values()];
}

async function buildBackup(project) {
  const api = window.videosStudio?.library;
  if (!api?.getDefaults || !api?.readBytes) {
    throw new Error('El respaldo portable necesita ejecutarse desde la aplicación de escritorio actualizada.');
  }

  const [takes, defaults, templatePreferences] = await Promise.all([
    getProjectTakes(project.id),
    api.getDefaults(),
    getTemplatePreferences(project.id),
  ]);
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

  const resolvedAssignments = buildResolvedAssignments(project, defaults || {}, templatePreferences);
  const portableResources = [];
  for (const resource of collectPortableResources(project, resolvedAssignments)) {
    let item;
    try {
      item = await api.readBytes({ path: resource.path });
    } catch (caught) {
      throw new Error(`No se pudo incluir un recurso usado por el proyecto: ${resource.path}. ${caught?.message || ''}`.trim());
    }
    const data = item?.data;
    const blob = data ? new Blob([data], { type: item.type || 'application/octet-stream' }) : null;
    if (!blob?.size) throw new Error(`El recurso ${resource.path} está vacío o no se pudo leer.`);
    portableResources.push({
      category: resource.category,
      originalPath: resource.path,
      name: item.name || safeFileName(resource.path),
      blobRef: addBlob(`library-${resource.category}`, blob, item.name || resource.path),
    });
  }

  const header = {
    format: MAGIC,
    version: 2,
    createdAt: new Date().toISOString(),
    project,
    takes: takeManifest,
    visuals: visualManifest,
    visualSettings,
    templatePreferences,
    resolvedAssignments,
    portableResources,
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
  if (header?.format !== MAGIC || ![1, 2].includes(Number(header?.version)) || !header?.project?.slides) {
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

function mappedPath(pathMap, originalPath) {
  return originalPath ? (pathMap.get(originalPath) || originalPath) : '';
}

function applyPortableAssignments(project, assignments, pathMap) {
  if (!assignments) return project;
  const plan = project.productionPlan || {};
  const transitions = {};
  for (const [number, path] of Object.entries(assignments.transitions || {})) {
    transitions[number] = mappedPath(pathMap, path) || NONE;
  }
  const ctaAssets = {};
  for (const [number, path] of Object.entries(assignments.ctaAssets || {})) {
    if (path) ctaAssets[number] = mappedPath(pathMap, path);
  }
  return {
    ...project,
    productionPlan: {
      ...plan,
      intro: mappedPath(pathMap, assignments.intro) || NONE,
      ending: mappedPath(pathMap, assignments.ending) || NONE,
      transitionDefault: mappedPath(pathMap, assignments.transitionDefault) || NONE,
      transitions,
      ctaAssets,
      memes: (plan.memes || []).map((item) => ({
        ...item,
        assetPath: mappedPath(pathMap, item.assetPath),
      })),
    },
  };
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
    setMessage('Preparando respaldo portable…');
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
      setMessage(`Respaldo portable creado · ${formatBytes(blob.size)}. Incluye proyecto, tomas, cortes, imágenes y recursos de Biblioteca usados.`);
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
      const api = window.videosStudio?.library;
      const pathMap = new Map();

      if ((header.portableResources || []).length) {
        if (!api?.writeBytes) throw new Error('Este respaldo portable requiere una versión actualizada de Videos Studio.');
        setMessage('Restaurando recursos de Biblioteca…');
        for (const resource of header.portableResources) {
          const blob = getBlob(resource.blobRef);
          if (!blob?.size) throw new Error(`Falta el recurso portable ${resource.name || resource.originalPath}.`);
          const item = await api.writeBytes({
            scope: resource.category === 'templates' ? 'global' : 'project',
            projectId: resource.category === 'templates' ? '' : newProjectId,
            category: resource.category,
            name: resource.name,
            data: new Uint8Array(await blob.arrayBuffer()),
          });
          if (item?.path) pathMap.set(resource.originalPath, item.path);
        }
      }

      let restoredProject = {
        ...header.project,
        id: newProjectId,
        name: `${header.project.name || 'Proyecto'} (restaurado)`,
        updatedAt: Date.now(),
      };
      restoredProject = applyPortableAssignments(restoredProject, header.resolvedAssignments, pathMap);
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

      const sourcePreferences = header.resolvedAssignments?.templates || header.templatePreferences;
      if (sourcePreferences) {
        await setTemplatePreferences(newProjectId, {
          defaultPath: mappedPath(pathMap, sourcePreferences.defaultPath),
          perSlide: Object.fromEntries(
            Object.entries(sourcePreferences.perSlide || {}).map(([number, path]) => [number, mappedPath(pathMap, path)]),
          ),
        });
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
            <h2>Respaldo portable</h2>
            <p>Guarda una copia transportable del proyecto, incluidas las piezas de Biblioteca que realmente utiliza.</p>
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

        <small className="backup-note">Incluye guion, estado, grabaciones originales, cortes, imágenes y los intros/transiciones/endings/CTA/memes/fondos que estén asignados al proyecto. Los respaldos antiguos versión 1 siguen siendo compatibles.</small>
        {message && <div className="backup-message">{message}</div>}
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{button}{modal}</>;
}
