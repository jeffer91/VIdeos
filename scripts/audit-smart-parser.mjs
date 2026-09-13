import assert from 'node:assert/strict';
import { AI_FORMAT_RULES, parseSlides } from '../src/parser.js';
import { CHANNEL_PROFILE } from '../src/channel.js';

assert.equal(CHANNEL_PROFILE.name, '11 Records', 'El canal predeterminado debe ser 11 Records.');
assert(AI_FORMAT_RULES.includes('11 Records'), 'Las reglas IA deben incluir el nombre 11 Records.');
assert(AI_FORMAT_RULES.includes('récords'), 'Las reglas IA deben conservar el enfoque editorial de récords de fútbol.');

const pastedFromChat = `DIAPOSITIVA 1

GANCHO:
¡Esto acaba de cambiar la historia!

TÍTULO:
Prueba de pegado inteligente

CUERPO:
-  Primer punto con dos espacios.
– Segundo punto con guion Unicode.
• Tercer punto con viñeta.

CONTENIDO:
-  Dato uno.
* Dato dos.
1. Dato tres.

LECTURA:
Esta lectura confirma que el contenido pegado puede normalizarse sin bloquear el proyecto.

VISUAL:
TIPO: GRAFICO\\_BARRAS
DESCRIPCIÓN: Comparativa de prueba.
Dato 1: A — 10.
Dato 2: B — 8.

CTA:
TIPO: PREGUNTA
TEXTO:
¿Qué dato te sorprende más?

//

DIAPOSITIVA 2

GANCHO:
Y esto sigue.

TÍTULO:
Cierre

CUERPO:
- Punto final.

CONTENIDO:
- Dato final.

LECTURA:
Suscríbete a 11 Records para más récords brutales del fútbol mundial.

VISUAL:
TIPO: IMAGEN
DESCRIPCIÓN: Imagen final.

CTA:
TIPO: SUSCRIBIRSE
TEXTO:
Suscríbete a 11 Records.

//`;

const parsed = parseSlides(pastedFromChat);
assert.deepEqual(parsed.errors, [], `El contenido pegado produjo errores bloqueantes: ${parsed.errors.join(' | ')}`);
assert.equal(parsed.slides.length, 2, 'Deben detectarse las dos diapositivas.');
assert.equal(parsed.slides[0].visualType, 'GRAFICO_BARRAS', 'Debe normalizar GRAFICO\\_BARRAS.');
assert.equal(parsed.slides[0].validation.bodyBulleted, true, 'CUERPO debe aceptar variantes de viñetas.');
assert.equal(parsed.slides[0].validation.contentBulleted, true, 'CONTENIDO debe aceptar variantes de viñetas.');
assert(parsed.slides[0].body.split('\n').every((line) => line.startsWith('- ')), 'CUERPO debe quedar normalizado con guion estándar.');
assert(parsed.slides[0].content.split('\n').every((line) => line.startsWith('- ')), 'CONTENIDO debe quedar normalizado con guion estándar.');
assert(parsed.corrections.length >= 1, 'El parser debe informar que realizó autocorrecciones de formato.');

const markdownPaste = parseSlides(`**DIAPOSITIVA 1**\n**GANCHO:**\nGancho.\n**TÍTULO:**\nTítulo.\n**CUERPO:**\n- Punto.\n**CONTENIDO:**\n- Dato.\n**LECTURA:**\nSuscríbete a 11 Records.\n**VISUAL:**\nTIPO: IMAGEN\nDESCRIPCIÓN: Imagen.\n**CTA:**\nTIPO: SUSCRIBIRSE\nTEXTO: Suscríbete.\n//`);
assert.deepEqual(markdownPaste.errors, [], `El pegado con negritas Markdown no debe romperse: ${markdownPaste.errors.join(' | ')}`);

console.log(`Auditoría parser inteligente OK · ${parsed.slides.length} diapositivas · ${parsed.corrections.length} correcciones automáticas.`);
