import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

const [guard, app, projectManager, visualStore] = await Promise.all([
  read('src/IntegrityGuard.jsx'),
  read('src/App.jsx'),
  read('src/ProjectManager.jsx'),
  read('src/visualStore.js'),
]);

assert(app.includes('<IntegrityGuard />'), 'IntegrityGuard debe estar montado globalmente.');
assert(guard.includes('(Number(take?.updatedAt) || 0) > sceneUpdatedAt'), 'Una toma modificada después del montaje debe invalidar la escena.');
assert(guard.includes('visualCount < 1'), 'Una escena sin imágenes reales no puede permanecer lista.');
assert(guard.includes('scene.visualImages') && guard.includes('!== visualCount'), 'Cambiar la cantidad de imágenes debe invalidar un montaje revisado.');
assert(guard.includes("String(scene?.transition || '') !== String(currentTransition || '')"), 'Cambiar la transición efectiva debe invalidar el montaje.');
assert(guard.includes("String(scene?.ctaAsset || '') !== String(currentCta || '')"), 'Cambiar el CTA efectivo debe invalidar el montaje.');
assert(guard.includes('templateAssignmentChanged'), 'Cambiar la plantilla asignada debe invalidar escenas revisadas.');
assert(guard.includes('templateMetadataChanged'), 'Cambiar zonas o metadata de una plantilla debe invalidar escenas revisadas.');
assert(guard.includes('templateChangedAfterReview'), 'Una plantilla reanalizada después de revisar la escena debe invalidarla.');
assert(guard.includes('pruneObject(originalPlan.scenes'), 'Las escenas de diapositivas eliminadas deben limpiarse.');
assert(guard.includes('pruneObject(originalPlan.transitions'), 'Las transiciones huérfanas deben limpiarse.');
assert(guard.includes('pruneObject(originalPlan.ctaAssets'), 'Los CTA huérfanos deben limpiarse.');
assert(guard.includes('30000'), 'La comprobación de respaldo no debe ejecutarse a una frecuencia agresiva.');

assert(projectManager.includes('getRecordingMeta'), 'Cambiar de proyecto debe comprobar grabaciones recuperables.');
assert(projectManager.includes('getChunks'), 'La protección debe verificar que realmente existan fragmentos recuperables.');
assert(projectManager.includes('confirmDiscardRecovery'), 'Debe existir una confirmación explícita antes de descartar recuperación.');
assert(projectManager.indexOf('confirmDiscardRecovery') < projectManager.lastIndexOf('await clearRecordingData();'), 'La recuperación debe comprobarse antes de limpiar temporales.');

assert(visualStore.includes("db.transaction([ASSETS_STORE, SETTINGS_STORE], 'readonly')"), 'La limpieza de visuales debe revisar assets y ajustes.');
assert(visualStore.includes('staleSettings'), 'Los ajustes visuales de diapositivas eliminadas también deben podarse.');
assert(visualStore.includes('settingsStore.delete(row.key)'), 'Los ajustes huérfanos deben eliminarse físicamente.');

console.log('Auditoría de integridad OK · tomas, visuales, plantillas, transiciones, CTA, recuperación y huérfanos protegidos.');
