import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_FORMAT_RULES, AI_MASTER_PROMPT, parseSlides } from '../src/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

assert.equal(AI_FORMAT_RULES, AI_MASTER_PROMPT, 'El alias antiguo debe apuntar al prompt maestro actual.');
assert(AI_MASTER_PROMPT.includes('PROMPT MAESTRO'), 'Debe existir un prompt maestro.');
assert(AI_MASTER_PROMPT.includes('===DIAPOSITIVA 1==='), 'El prompt debe usar el formato estructurado.');
assert(AI_MASTER_PROMPT.includes('CUERPO_1='), 'CUERPO debe usar campos numerados.');
assert(AI_MASTER_PROMPT.includes('CONTENIDO_1='), 'CONTENIDO debe usar campos numerados.');

const production = await read('src/ProductionApp.jsx');
const appSource = await read('src/App.jsx');
const preload = await read('electron/preload.cjs');
const main = await read('electron/main.cjs');

assert(production.includes('Copiar prompt IA'), 'La interfaz debe mostrar Copiar prompt IA de forma nativa.');
assert(production.includes('Descargar prompt'), 'La interfaz debe mostrar Descargar prompt de forma nativa.');
assert(production.includes('prompt-maestro-11-records-videos-studio.txt'), 'La descarga debe tener un nombre claro.');
assert(production.includes('AI_MASTER_PROMPT'), 'ProductionApp debe usar directamente el prompt maestro.');
assert(production.includes("window.videosStudio?.clipboard?.writeText"), 'La copia debe priorizar el portapapeles nativo de Electron.');
assert(production.includes('===DIAPOSITIVA 1==='), 'El cuadro de pegado debe enseñar el formato nuevo.');
assert(!production.includes('Copiar reglas IA'), 'No deben quedar controles antiguos de reglas.');
assert(!appSource.includes('ClipboardEnhancer'), 'La app no debe depender de un enhancer para renombrar botones.');
assert(!existsSync(path.join(root, 'src/ClipboardEnhancer.jsx')), 'El enhancer antiguo debe haberse eliminado.');
assert(preload.includes("ipcRenderer.invoke('clipboard:write-text', text)"), 'Preload debe exponer el canal seguro de portapapeles.');
assert(main.includes("ipcMain.handle('clipboard:write-text'"), 'Electron main debe implementar el portapapeles.');
assert(main.includes('assertTrustedIpc(event)'), 'Los IPC sensibles deben validar el origen.');
assert(main.includes('autoUpdater.autoInstallOnAppQuit = false'), 'Una actualización descargada no debe instalarse sin acción explícita.');

const sample = `===DIAPOSITIVA 1===\n===GANCHO===\nEsto cambia todo.\n===TITULO===\nPrueba\n===CUERPO===\nCUERPO_1=Punto uno.\n===CONTENIDO===\nCONTENIDO_1=Dato uno.\n===LECTURA===\nSuscríbete a 11 Records.\n===FIN_LECTURA===\n===VISUAL===\nVISUAL_TIPO=IMAGEN\nVISUAL_DESCRIPCION=Imagen de prueba.\n===CTA===\nCTA_TIPO=SUSCRIBIRSE\nCTA_TEXTO=Suscríbete.\n===FIN_DIAPOSITIVA 1===`;
const parsed = parseSlides(sample);
assert.equal(parsed.errors.length, 0, `El formato del prompt debe ser aceptado: ${parsed.errors.join(' | ')}`);
assert.equal(parsed.slides.length, 1);
assert.equal(parsed.inputKind, 'structured-script');

console.log(`Auditoría portapapeles OK · ${AI_MASTER_PROMPT.length} caracteres · prompt nativo, formato estructurado e IPC validados.`);
