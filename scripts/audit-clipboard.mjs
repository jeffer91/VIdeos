import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_FORMAT_RULES, parseSlides } from '../src/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

const requiredMarkers = ['PROMPT MAESTRO', '===DIAPOSITIVA 1===', '===GANCHO===', '===TITULO===', '===CUERPO===', 'CUERPO_1=', '===CONTENIDO===', 'CONTENIDO_1=', '===LECTURA===', '===FIN_LECTURA===', '===VISUAL===', 'VISUAL_TIPO=', '===CTA===', 'CTA_TIPO=', '===FIN_DIAPOSITIVA 1==='];
for (const marker of requiredMarkers) assert(AI_FORMAT_RULES.includes(marker), `El prompt debe incluir ${marker}`);
assert(AI_FORMAT_RULES.includes('Devuelve únicamente el contenido destinado a Videos Studio'), 'El prompt debe pedir una salida limpia.');
assert(AI_FORMAT_RULES.includes('No uses bloques de código Markdown'), 'El prompt debe evitar Markdown que pueda ensuciar el pegado.');

const production = await read('src/ProductionApp.jsx');
const enhancer = await read('src/ClipboardEnhancer.jsx');
const appSource = await read('src/App.jsx');
const preload = await read('electron/preload.cjs');
const main = await read('electron/main.cjs');

assert(production.includes('Copiar reglas IA'), 'ProductionApp conserva el control base que el enhancer transforma a prompt.');
assert(enhancer.includes('Copiar prompt IA'), 'La interfaz debe mostrar Copiar prompt IA.');
assert(enhancer.includes('Descargar prompt'), 'La interfaz debe mostrar Descargar prompt.');
assert(enhancer.includes('prompt-maestro-11-records-videos-studio.txt'), 'La descarga debe tener un nombre claro.');
assert(enhancer.includes("window.videosStudio?.clipboard?.writeText"), 'La copia debe priorizar el portapapeles nativo de Electron.');
assert(enhancer.includes('navigator.clipboard?.writeText'), 'Debe existir respaldo web para el portapapeles.');
assert(enhancer.includes("document.execCommand?.('copy')"), 'Debe existir un último respaldo para contextos sin Clipboard API.');
assert(enhancer.includes("event.stopImmediatePropagation?.()"), 'El enhancer debe impedir una segunda acción del handler antiguo.');
assert(enhancer.includes("Number(result.length) !== AI_FORMAT_RULES.length"), 'La copia nativa debe verificarse antes de mostrar éxito.');
assert(appSource.includes('<ClipboardEnhancer />'), 'ClipboardEnhancer debe estar montado globalmente.');
assert(preload.includes("ipcRenderer.invoke('clipboard:write-text', text)"), 'Preload debe exponer el canal seguro de portapapeles.');
assert(main.includes("ipcMain.handle('clipboard:write-text'"), 'Electron main debe implementar el canal de portapapeles.');
assert(main.includes("clipboard.readText('clipboard')"), 'Electron main debe verificar que el texto realmente quedó copiado.');
assert(main.includes('isTrustedRendererOrigin(senderUrl)'), 'El canal de portapapeles debe rechazar orígenes no confiables.');

const sample = `===DIAPOSITIVA 1===\n===GANCHO===\nEsto cambia todo.\n===TITULO===\nPrueba\n===CUERPO===\nCUERPO_1=Punto uno.\n===CONTENIDO===\nCONTENIDO_1=Dato uno.\n===LECTURA===\nSuscríbete a 11 Records.\n===FIN_LECTURA===\n===VISUAL===\nVISUAL_TIPO=IMAGEN\nVISUAL_DESCRIPCION=Imagen de prueba.\n===CTA===\nCTA_TIPO=SUSCRIBIRSE\nCTA_TEXTO=Suscríbete.\n===FIN_DIAPOSITIVA 1===`;
const parsed = parseSlides(sample);
assert.equal(parsed.errors.length, 0, `El formato descrito por el prompt debe ser aceptado: ${parsed.errors.join(' | ')}`);
assert.equal(parsed.slides.length, 1, 'El prompt debe producir una diapositiva válida.');
assert.equal(parsed.inputKind, 'structured-script');

console.log(`Auditoría portapapeles OK · ${AI_FORMAT_RULES.length} caracteres · prompt maestro y puente nativo verificados.`);
