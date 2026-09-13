import assert from 'node:assert/strict';
import { AI_FORMAT_RULES, parseSlides } from '../src/parser.js';
import { CHANNEL_PROFILE } from '../src/channel.js';

assert.equal(CHANNEL_PROFILE.name, '11 Records', 'El canal predeterminado debe ser 11 Records.');
assert(AI_FORMAT_RULES.includes('11 Records'), 'El prompt IA debe incluir el nombre 11 Records.');
assert(AI_FORMAT_RULES.includes('récords'), 'El prompt IA debe conservar el enfoque editorial de récords de fútbol.');
assert(AI_FORMAT_RULES.includes('PROMPT MAESTRO'), 'La ayuda para IA debe presentarse como prompt maestro, no como reglamento largo.');
assert(AI_FORMAT_RULES.includes('Este prompt se pega en ChatGPT u otra IA'), 'El prompt debe explicar claramente dónde se pega.');

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
Punto final sin viñeta porque el portapapeles la perdió.

CONTENIDO:
Dato final sin viñeta.

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
assert.equal(parsed.inputKind, 'script', 'Un guion real debe clasificarse como script.');
assert.equal(parsed.slides.length, 2, 'Deben detectarse las dos diapositivas.');
assert.equal(parsed.slides[0].visualType, 'GRAFICO_BARRAS', 'Debe normalizar GRAFICO\\_BARRAS.');
assert.equal(parsed.slides[0].validation.bodyBulleted, true, 'CUERPO debe aceptar variantes de viñetas.');
assert.equal(parsed.slides[0].validation.contentBulleted, true, 'CONTENIDO debe aceptar variantes de viñetas.');
assert.equal(parsed.slides[1].validation.bodyBulleted, true, 'CUERPO debe recuperar una viñeta perdida al pegar.');
assert.equal(parsed.slides[1].validation.contentBulleted, true, 'CONTENIDO debe recuperar una viñeta perdida al pegar.');
assert(parsed.slides[0].body.split('\n').every((line) => line.startsWith('- ')), 'CUERPO debe quedar normalizado con guion estándar.');
assert(parsed.slides[0].content.split('\n').every((line) => line.startsWith('- ')), 'CONTENIDO debe quedar normalizado con guion estándar.');
assert(parsed.slides[1].body.startsWith('- '), 'Una línea de CUERPO sin viñeta debe recibirla automáticamente.');
assert(parsed.slides[1].content.startsWith('- '), 'Una línea de CONTENIDO sin viñeta debe recibirla automáticamente.');
assert(parsed.corrections.length >= 1, 'El parser debe informar que realizó autocorrecciones de formato.');

const markdownPaste = parseSlides(`**DIAPOSITIVA 1**\n**GANCHO:**\nGancho.\n**TÍTULO:**\nTítulo.\n**CUERPO:**\nPunto sin guion.\n**CONTENIDO:**\nDato sin guion.\n**LECTURA:**\nSuscríbete a 11 Records.\n**VISUAL:**\nTIPO: IMAGEN\nDESCRIPCIÓN: Imagen.\n**CTA:**\nTIPO: SUSCRIBIRSE\nTEXTO: Suscríbete.\n//`);
assert.deepEqual(markdownPaste.errors, [], `El pegado con Markdown o pérdida de viñetas no debe romperse: ${markdownPaste.errors.join(' | ')}`);

const promptPaste = parseSlides(AI_FORMAT_RULES);
assert.equal(promptPaste.inputKind, 'prompt', 'El prompt copiado no debe interpretarse como un video.');
assert.equal(promptPaste.slides.length, 0, 'El prompt no debe crear diapositivas falsas.');
assert.equal(promptPaste.errors.length, 1, 'El prompt debe producir un único mensaje útil, no una cascada de errores.');
assert(promptPaste.errors[0].includes('Pegaste el prompt'), 'El mensaje debe explicar que se pegó el prompt en vez del guion.');

const placeholderTemplate = parseSlides(`DIAPOSITIVA 1\nGANCHO:\n[Gancho potente]\nTÍTULO:\n[Título corto]\nCUERPO:\n- [Idea principal 1]\nCONTENIDO:\n- [Dato 1]\nLECTURA:\n[Texto natural]\nVISUAL:\nTIPO: IMAGEN\nDESCRIPCIÓN: [Imagen]\nCTA:\nTIPO: SUSCRIBIRSE\nTEXTO: [CTA]`);
assert.equal(placeholderTemplate.inputKind, 'template', 'Una plantilla sin completar debe detectarse como plantilla.');
assert.equal(placeholderTemplate.slides.length, 0, 'Una plantilla vacía no debe convertirse en proyecto.');

const mixedPaste = parseSlides(`${AI_FORMAT_RULES}\n\n${pastedFromChat}`);
assert.equal(mixedPaste.inputKind, 'script', 'Si el prompt y el guion vienen mezclados, debe extraerse el guion real.');
assert.deepEqual(mixedPaste.errors, [], `El guion mezclado con prompt no debe fallar: ${mixedPaste.errors.join(' | ')}`);
assert.equal(mixedPaste.slides.length, 2, 'Deben extraerse solo las diapositivas reales del contenido mezclado.');
assert(mixedPaste.corrections.some((item) => item.includes('extrajo automáticamente')), 'Debe informar que separó el prompt del guion.');

console.log(`Auditoría parser inteligente OK · ${parsed.slides.length} diapositivas · prompt y viñetas perdidas manejados correctamente.`);
