import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSlides } from '../src/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const validTemplate = `DIAPOSITIVA 1
GANCHO:
Esto cambia la historia.

TÍTULO:
Inicio

CUERPO:
- Punto 1.

CONTENIDO:
- Dato 1.

LECTURA:
Lectura uno.

VISUAL:
TIPO: IMAGEN
DESCRIPCIÓN: Imagen uno.

CTA:
TIPO: NINGUNO
TEXTO:

//

DIAPOSITIVA 2
GANCHO:

TÍTULO:
Desarrollo

CUERPO:
- Punto 2.

CONTENIDO:
- Dato 2.

LECTURA:
Lectura dos.

VISUAL:
TIPO: GRAFICO_BARRAS
DATOS:
- A | 10
- B | 8

CTA:
TIPO: NINGUNO
TEXTO:

//

DIAPOSITIVA 3
GANCHO:

TÍTULO:
Interacción

CUERPO:
- Punto 3.

CONTENIDO:
- Dato 3.

LECTURA:
Comenta cuál elegirías.

VISUAL:
TIPO: TABLA
DATOS:
- A | 10
- B | 8

CTA:
TIPO: COMENTAR
TEXTO: Déjalo en los comentarios.

//

DIAPOSITIVA 4
GANCHO:

TÍTULO:
Cierre de datos

CUERPO:
- Punto 4.

CONTENIDO:
- Dato 4.

LECTURA:
Lectura cuatro.

VISUAL:
TIPO: COMPARATIVA
DESCRIPCIÓN: Comparación final.

CTA:
TIPO: NINGUNO
TEXTO:

//

DIAPOSITIVA 5
GANCHO:

TÍTULO:
Final

CUERPO:
- Punto 5.

CONTENIDO:
- Dato 5.

LECTURA:
Suscríbete para el próximo video.

VISUAL:
TIPO: IMAGEN
DESCRIPCIÓN: Imagen de cierre.

CTA:
TIPO: SUSCRIBIRSE
TEXTO: Suscríbete.

//`;

const parsed = parseSlides(validTemplate);
assert.deepEqual(parsed.errors, [], `La plantilla válida produjo errores: ${parsed.errors.join(' | ')}`);
assert.deepEqual(parsed.warnings, [], `La plantilla válida produjo advertencias: ${parsed.warnings.join(' | ')}`);
assert.equal(parsed.slides.length, 5, 'La plantilla válida debe producir 5 diapositivas.');
assert.equal(parsed.slides[1].visualType, 'GRAFICO_BARRAS');
assert.equal(parsed.slides[2].ctaType, 'COMENTAR');
assert.equal(parsed.slides[4].ctaType, 'SUSCRIBIRSE');

const numbering = parseSlides(validTemplate.replace('DIAPOSITIVA 4', 'DIAPOSITIVA 7'));
assert(numbering.errors.some((message) => message.includes('numeración debe ser consecutiva')), 'Debe detectarse una numeración no consecutiva.');

const invalidVisual = parseSlides(validTemplate.replace('TIPO: IMAGEN\nDESCRIPCIÓN: Imagen uno.', 'TIPO: VIDEO_3D\nDESCRIPCIÓN: Imagen uno.'));
assert(invalidVisual.warnings.some((message) => message.includes('TIPO de VISUAL no reconocido')), 'Debe detectarse un VISUAL no reconocido.');

const production = await read('src/ProductionApp.jsx');
const mainProcess = await read('electron/main.cjs');
const preload = await read('electron/preload.cjs');
const gitignore = await read('.gitignore');

const navOrder = ['Contenido', 'Grabación', 'Corte', 'Biblioteca', 'Unión', 'Video memes', 'Resultado'];
let previousIndex = -1;
for (const label of navOrder) {
  const index = production.indexOf(`'${label}'`);
  assert(index > previousIndex, `La navegación no mantiene el orden esperado en ${label}.`);
  previousIndex = index;
}

assert(production.includes("import { cutMedia } from './ffmpeg';"), 'Corte debe usar cutMedia.');
assert(production.includes('getRecordingMeta'), 'La recuperación de grabaciones debe leer metadata.');
assert(production.includes('deleteSlideTake'), 'La actualización de contenido debe poder limpiar tomas huérfanas.');
assert(production.includes('Transición después de esta escena'), 'La transición debe modelarse como un clip después de una escena (modo A).');
assert(production.includes('El video principal se congela; aparece el meme; al terminar, continúa exactamente donde estaba.'), 'La lógica de video memes debe conservar pausa + reanudación.');

const channels = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1]);
assert(channels.length > 0, 'Preload debe exponer canales IPC.');
for (const channel of channels) {
  assert(mainProcess.includes(`ipcMain.handle('${channel}'`), `Falta el handler IPC ${channel} en electron/main.cjs.`);
}

assert(gitignore.split(/\r?\n/).some((line) => line.trim() === 'library/'), 'La carpeta library/ debe estar ignorada por Git para evitar subir videos locales.');

console.log(`Auditoría OK · ${parsed.slides.length} diapositivas de prueba · ${channels.length} canales IPC conectados · ${navOrder.length} etapas verificadas.`);
