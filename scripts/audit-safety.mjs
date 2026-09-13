import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const [
  app,
  recovery,
  verification,
  storage,
  workflow,
  integrity,
  backup,
  renderer,
  finalManager,
  main,
  preload,
  html,
] = await Promise.all([
  read('src/App.jsx'),
  read('src/RecoverySafetyGuard.jsx'),
  read('src/VerificationManager.jsx'),
  read('src/storage.js'),
  read('src/WorkflowEnhancer.jsx'),
  read('src/IntegrityGuard.jsx'),
  read('src/ProjectBackupManager.jsx'),
  read('src/productionRenderer.js'),
  read('src/FinalRenderManager.jsx'),
  read('electron/main.cjs'),
  read('electron/preload.cjs'),
  read('index.html'),
]);

assert(app.includes('<RecoverySafetyGuard />'), 'La protección de recuperación debe estar montada.');
assert(recovery.includes('.recording-flow .record-button'), 'Debe bloquearse Grabar cuando hay recuperación pendiente.');
assert(recovery.includes('clearRecordingData'), 'Debe existir descarte explícito de una recuperación.');
assert(app.includes('<VerificationManager />'), 'La verificación factual debe estar integrada.');
assert(verification.includes('verificationIsCurrent'), 'La verificación debe invalidarse si cambia la diapositiva.');
assert(verification.includes('.recording-flow .record-button'), 'La grabación debe exigir verificación actual.');

assert(storage.includes('getProjectTakeMetadata'), 'Debe existir lectura ligera de metadata de tomas.');
assert(workflow.includes('getProjectTakeMetadata'), 'El progreso no debe cargar blobs completos periódicamente.');
assert(integrity.includes('getProjectTakeMetadata'), 'La auditoría de integridad no debe cargar blobs completos periódicamente.');
assert(workflow.includes('hasCleanedBlob'), 'El progreso debe usar la bandera ligera de corte limpio.');
assert(integrity.includes('hasCleanedBlob'), 'Integridad debe usar la bandera ligera de corte limpio.');

assert(main.includes("ipcMain.handle('library:read-bytes'"), 'Electron debe permitir leer de forma segura recursos usados por respaldo/render.');
assert(main.includes("ipcMain.handle('library:write-bytes'"), 'Electron debe permitir restaurar recursos portables.');
assert(preload.includes('readBytes:'), 'Preload debe exponer lectura segura de bytes.');
assert(preload.includes('writeBytes:'), 'Preload debe exponer restauración segura de bytes.');
assert(backup.includes('portableResources'), 'El respaldo debe incluir recursos de Biblioteca usados.');
assert(backup.includes('resolvedAssignments'), 'El respaldo debe guardar asignaciones efectivas para ser portable.');

assert(renderer.includes('renderProductionVideo'), 'Debe existir un compositor final de producción.');
assert(renderer.includes('createSceneBackground'), 'El render debe componer plantilla/datos por escena.');
assert(renderer.includes('expandSceneWithMemes'), 'El render debe insertar video memes sin perder el punto de reanudación.');
assert(finalManager.includes('renderProductionVideo'), 'Resultado debe usar el compositor final, no solo concatenar videos limpios.');
assert(finalManager.includes('listVisualAssets'), 'El render final debe cargar las imágenes reales de cada escena.');

assert(html.includes('Content-Security-Policy'), 'El renderer debe tener CSP.');
assert(html.includes("object-src 'none'"), 'La CSP debe bloquear objetos embebidos.');
const updateSection = main.match(/function configureUpdateIpc\(\)[\s\S]*?function configureAutoUpdater/)?.[0] || '';
assert(updateSection.includes('assertTrustedIpc(event)'), 'Los IPC de actualización deben validar el origen.');

console.log('Safety audit OK');
