import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_FORMAT_RULES, parseSlides } from '../src/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

const requiredFields = ['GANCHO:', 'TÍTULO:', 'CUERPO:', 'CONTENIDO:', 'LECTURA:', 'VISUAL:', 'CTA:'];
for (const field of requiredFields) {
  assert(AI_FORMAT_RULES.includes(field), `Las reglas copiadas deben incluir ${field}`);
}
assert(AI_FORMAT_RULES.includes('DIAPOSITIVA 1'), 'Las reglas deben explicar cómo inicia cada diapositiva.');
assert(AI_FORMAT_RULES.includes('//'), 'Las reglas deben incluir el separador entre diapositivas.');
assert(AI_FORMAT_RULES.includes('Devuelve solamente las diapositivas'), 'Las reglas deben pedir una salida limpia para pegarla directamente en la app.');

const production = await read('src/ProductionApp.jsx');
const enhancer = await read('src/ClipboardEnhancer.jsx');
const appSource = await read('src/App.jsx');
const preload = await read('electron/preload.cjs');
const main = await read('electron/main.cjs');

assert(production.includes('Copiar reglas IA'), 'Contenido debe conservar el botón Copiar reglas IA.');
assert(production.includes('Descargar reglas'), 'Debe existir Descargar reglas como respaldo.');
assert(enhancer.includes("window.videosStudio?.clipboard?.writeText"), 'La copia debe priorizar el portapapeles nativo de Electron.');
assert(enhancer.includes('navigator.clipboard?.writeText'), 'Debe existir respaldo web para el portapapeles.');
assert(enhancer.includes("document.execCommand?.('copy')"), 'Debe existir un último respaldo para contextos sin Clipboard API.');
assert(enhancer.includes("event.stopImmediatePropagation?.()"), 'El puente debe impedir que el handler antiguo ejecute una segunda copia.');
assert(enhancer.includes("Number(result.length) !== AI_FORMAT_RULES.length"), 'La copia nativa debe verificarse antes de mostrar éxito.');
assert(appSource.includes('<ClipboardEnhancer />'), 'ClipboardEnhancer debe estar montado globalmente.');
assert(preload.includes("ipcRenderer.invoke('clipboard:write-text', text)"), 'Preload debe exponer el canal seguro de portapapeles.');
assert(main.includes("ipcMain.handle('clipboard:write-text'"), 'Electron main debe implementar el canal de portapapeles.');
assert(main.includes("clipboard.readText('clipboard')"), 'Electron main debe verificar que el texto realmente quedó copiado.');
assert(main.includes('isTrustedRendererOrigin(senderUrl)'), 'El canal de portapapeles debe rechazar orígenes no confiables.');

const sample = `DIAPOSITIVA 1\nGANCHO:\nEsto cambia todo.\n\nTÍTULO:\nPrueba\n\nCUERPO:\n- Punto uno.\n\nCONTENIDO:\n- Dato uno.\n\nLECTURA:\nTexto para leer.\n\nVISUAL:\nTIPO: IMAGEN\nDESCRIPCIÓN: Imagen de prueba.\n\nCTA:\nTIPO: SUSCRIBIRSE\nTEXTO: Suscríbete.\n\n//`;
const parsed = parseSlides(sample);
assert.equal(parsed.errors.length, 0, `El formato descrito por las reglas debe ser aceptado por el parser: ${parsed.errors.join(' | ')}`);
assert.equal(parsed.slides.length, 1, 'El formato de reglas debe producir una diapositiva válida.');

console.log(`Auditoría portapapeles OK · ${AI_FORMAT_RULES.length} caracteres · ${requiredFields.length} campos obligatorios · puente nativo verificado.`);
