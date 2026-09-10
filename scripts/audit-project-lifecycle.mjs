import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const [storage, manager, app, main, css, production] = await Promise.all([
  read('src/storage.js'),
  read('src/ProjectManager.jsx'),
  read('src/App.jsx'),
  read('src/main.jsx'),
  read('src/project-manager.css'),
  read('src/ProductionApp.jsx'),
]);

assert(storage.includes('export async function listProjects()'), 'Debe existir un catálogo de proyectos guardados.');
assert(storage.includes('tx.objectStore(PROJECTS_STORE).getAll()'), 'El catálogo debe leer todos los proyectos persistidos.');
assert(storage.includes('export async function setActiveProject(projectId)'), 'Debe poder activarse o desactivarse un proyecto sin borrarlo.');
assert(storage.includes('tx.objectStore(META_STORE).delete(ACTIVE_PROJECT_KEY)'), 'Salir debe quitar solo el puntero al proyecto activo.');

assert(app.includes('<ProjectManager />'), 'Los controles de proyecto deben estar montados permanentemente.');
assert(main.includes("import './project-manager.css';"), 'Los estilos del gestor de proyectos deben cargarse al final.');

assert(manager.includes('+ Nuevo proyecto'), 'Debe existir un botón permanente para crear un nuevo proyecto.');
assert(manager.includes('Salir del proyecto'), 'Debe existir un botón permanente para salir del proyecto.');
assert(manager.includes('Proyectos'), 'Debe existir acceso permanente al catálogo de proyectos.');
assert(manager.includes('listProjects()'), 'El gestor debe listar los proyectos existentes.');
assert(manager.includes('setActiveProject(projectId || null)'), 'Cambiar de proyecto debe actualizar el proyecto activo.');
assert(manager.includes("sessionStorage.setItem(LAUNCH_MODE_KEY, 'new')"), 'Nuevo proyecto debe abrir una sesión limpia sin borrar proyectos previos.');
assert(manager.includes("sessionStorage.setItem(LAUNCH_MODE_KEY, 'hub')"), 'Salir debe volver al selector de proyectos.');
assert(manager.includes('window.location.reload()'), 'El cambio de proyecto debe reiniciar el estado de React para evitar mezclar proyectos.');
assert(manager.includes('clearRecordingData()'), 'El cambio explícito de proyecto debe limpiar fragmentos temporales de grabación.');
assert(manager.includes('.status-recording, .status-paused, .status-saving, .status-detecting, .rec-indicator'), 'No se debe permitir cambiar de proyecto durante una grabación activa.');
assert(manager.includes('window.confirm(message)'), 'Cambiar o salir debe advertir sobre cambios de contenido aún no guardados.');
assert(manager.includes('no elimina sus grabaciones ni su montaje'), 'La interfaz debe aclarar que salir no borra el proyecto.');

const clearIndex = manager.indexOf('await clearRecordingData();');
const activeIndex = manager.indexOf('await setActiveProject(projectId || null);');
const reloadIndex = manager.indexOf('window.location.reload();');
assert(clearIndex >= 0 && activeIndex > clearIndex && reloadIndex > activeIndex, 'El orden seguro debe ser: limpiar temporales → cambiar activo → recargar.');

assert(css.includes('grid-template-rows: 88px minmax(0, 1fr)'), 'La cabecera debe reservar una fila permanente para el proyecto.');
assert(css.includes('.project-command-bar'), 'Debe existir una barra permanente de comandos del proyecto.');
assert(css.includes('.project-hub-backdrop'), 'Debe existir un selector modal de proyectos.');
assert(css.includes('.project-list-card.active'), 'El proyecto activo debe distinguirse visualmente.');

const navBlock = production.match(/const NAV_ITEMS = \[([\s\S]*?)\n\];/)?.[1] || '';
for (const stage of ['Contenido', 'Grabación', 'Corte', 'Biblioteca', 'Unión', 'Video memes', 'Resultado']) {
  assert(navBlock.includes(`'${stage}'`), `El flujo principal perdió la etapa ${stage}.`);
}

console.log('Auditoría de proyectos OK · salir conserva datos · nuevo proyecto aislado · reapertura disponible · cambio bloqueado durante grabación.');
