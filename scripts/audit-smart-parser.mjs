import assert from 'node:assert/strict';
import { AI_FORMAT_RULES, parseSlides } from '../src/parser.js';
import { CHANNEL_PROFILE } from '../src/channel.js';

assert.equal(CHANNEL_PROFILE.name, '11 Records', 'El canal predeterminado debe ser 11 Records.');
assert(AI_FORMAT_RULES.includes('PROMPT MAESTRO'), 'La ayuda para IA debe ser un prompt maestro.');
assert(AI_FORMAT_RULES.includes('11 RECORDS'), 'El prompt debe identificar 11 Records.');
assert(AI_FORMAT_RULES.includes('===DIAPOSITIVA 1==='), 'El prompt debe usar separadores fuertes por diapositiva.');
assert(AI_FORMAT_RULES.includes('===GANCHO==='), 'El prompt debe separar GANCHO.');
assert(AI_FORMAT_RULES.includes('CUERPO_1='), 'El prompt debe usar campos numerados en CUERPO.');
assert(AI_FORMAT_RULES.includes('CONTENIDO_1='), 'El prompt debe usar campos numerados en CONTENIDO.');
assert(AI_FORMAT_RULES.includes('===FIN_LECTURA==='), 'LECTURA debe tener cierre explícito.');
assert(AI_FORMAT_RULES.includes('===FIN_DIAPOSITIVA 1==='), 'Cada diapositiva debe tener cierre explícito.');

const structured = `===DIAPOSITIVA 1===

===GANCHO===
¡Esto acaba de cambiar la historia!

===TITULO===
Prueba estructurada

===CUERPO===
CUERPO_1=Primer punto.
CUERPO_2=Segundo punto.
CUERPO_3=Tercer punto.

===CONTENIDO===
CONTENIDO_1=Dato uno.
CONTENIDO_2=Dato dos.
CONTENIDO_3=Dato tres.

===LECTURA===
Esta lectura confirma que el nuevo formato se entiende sin depender de Markdown.
===FIN_LECTURA===

===VISUAL===
VISUAL_TIPO=GRAFICO_BARRAS
VISUAL_DESCRIPCION=Comparativa de prueba.
VISUAL_DATO_1=A — 10.
VISUAL_DATO_2=B — 8.

===CTA===
CTA_TIPO=PREGUNTA
CTA_TEXTO=¿Qué dato te sorprende más?

===FIN_DIAPOSITIVA 1===

===DIAPOSITIVA 2===

===GANCHO===
Y esto sigue.

===TITULO===
Cierre

===CUERPO===
CUERPO_1=Punto final.

===CONTENIDO===
CONTENIDO_1=Dato final.

===LECTURA===
Suscríbete a 11 Records para más récords del fútbol mundial.
===FIN_LECTURA===

===VISUAL===
VISUAL_TIPO=IMAGEN
VISUAL_DESCRIPCION=Imagen final.

===CTA===
CTA_TIPO=SUSCRIBIRSE
CTA_TEXTO=Suscríbete a 11 Records.

===FIN_DIAPOSITIVA 2===`;

const parsed = parseSlides(structured);
assert.deepEqual(parsed.errors, [], `El nuevo formato produjo errores: ${parsed.errors.join(' | ')}`);
assert.equal(parsed.inputKind, 'structured-script');
assert.equal(parsed.slides.length, 2);
assert.equal(parsed.slides[0].visualType, 'GRAFICO_BARRAS');
assert.equal(parsed.slides[0].ctaType, 'PREGUNTA');
assert.equal(parsed.slides[1].ctaType, 'SUSCRIBIRSE');
assert(parsed.slides[0].body.split('\n').every((line) => line.startsWith('- ')), 'CUERPO debe convertirse al formato interno esperado.');
assert(parsed.slides[0].content.split('\n').every((line) => line.startsWith('- ')), 'CONTENIDO debe convertirse al formato interno esperado.');

const lostLabels = parseSlides(structured
  .replace('CUERPO_1=Primer punto.', 'Primer punto sin CUERPO_1 porque la IA falló.')
  .replace('CONTENIDO_1=Dato uno.', 'Dato uno sin CONTENIDO_1.'));
assert.deepEqual(lostLabels.errors, [], 'El parser debe recuperar líneas internas aunque falte CUERPO_X o CONTENIDO_X.');
assert(lostLabels.corrections.length >= 2, 'Debe registrar las correcciones automáticas.');

const legacy = `DIAPOSITIVA 1
GANCHO:
Gancho legado.
TÍTULO:
Título legado.
CUERPO:
Punto sin viñeta.
CONTENIDO:
Dato sin viñeta.
LECTURA:
Suscríbete a 11 Records.
VISUAL:
TIPO: IMAGEN
DESCRIPCIÓN: Imagen.
CTA:
TIPO: SUSCRIBIRSE
TEXTO: Suscríbete.
//`;
const legacyParsed = parseSlides(legacy);
assert.deepEqual(legacyParsed.errors, [], 'El formato anterior debe seguir funcionando.');
assert.equal(legacyParsed.inputKind, 'legacy-script');
assert(legacyParsed.slides[0].body.startsWith('- '), 'El formato anterior debe recuperar viñetas perdidas.');

const promptPaste = parseSlides(AI_FORMAT_RULES);
assert.equal(promptPaste.inputKind, 'prompt');
assert.equal(promptPaste.slides.length, 0);
assert.equal(promptPaste.errors.length, 1);
assert(promptPaste.errors[0].includes('Pegaste el prompt'));

const mixedPaste = parseSlides(`${AI_FORMAT_RULES}\n\n${structured}`);
assert.equal(mixedPaste.inputKind, 'structured-script');
assert.deepEqual(mixedPaste.errors, [], 'Prompt + respuesta deben separarse automáticamente.');
assert.equal(mixedPaste.slides.length, 2);
assert(mixedPaste.corrections.some((item) => item.includes('extrajo automáticamente')));

console.log(`Auditoría parser inteligente OK · ${parsed.slides.length} diapositivas · prompt estructurado y formato legado validados.`);
