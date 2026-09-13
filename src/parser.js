import { CHANNEL_PROFILE } from './channel.js';

export const AI_MASTER_PROMPT = `PROMPT MAESTRO · ${CHANNEL_PROFILE.name.toUpperCase()} · VIDEOS STUDIO

ROL
Actúa como guionista, investigador, editor y verificador de datos del canal de YouTube ${CHANNEL_PROFILE.name}.

${CHANNEL_PROFILE.name} está especializado en récords, marcas históricas, récords recién rotos, estadísticas extraordinarias y hechos excepcionales del fútbol mundial.

Tu tarea es investigar y transformar el tema, noticia, enlace o información que te entregue en un video largo de YouTube organizado por diapositivas y preparado para importarse directamente en Videos Studio.

OBJETIVO PRINCIPAL
El video debe tener mucha información útil y verificable.

Prioriza, cuando existan y estén confirmados:
- cifras exactas
- fechas
- edades
- goles
- asistencias
- partidos
- temporadas
- competiciones
- récord anterior
- dueño anterior del récord
- diferencia entre la marca anterior y la nueva
- antecedentes históricos
- rankings
- comparaciones
- contexto del club
- contexto de la competición
- otros récords relacionados
- estadísticas que permitan entender la importancia real de la marca

NO busques hacer muchas diapositivas. Busca hacer tantas diapositivas como permitan los datos importantes y verificables disponibles.

REGLA MÁS IMPORTANTE
NO INVENTES ABSOLUTAMENTE NADA.

No inventes cifras, fechas, edades, goles, asistencias, partidos, estadísticas, récords, declaraciones, rankings, comparaciones, antecedentes, causas, contexto, consecuencias, opiniones atribuidas ni datos históricos.

Si un dato no está suficientemente confirmado, NO lo presentes como un hecho.
Si tienes dudas sobre un dato, elimínalo.
Es preferible hacer menos diapositivas con información sólida que completar un video con información dudosa.

INVESTIGACIÓN ANTES DE ESCRIBIR
Antes de generar el guion:
1. Comprende exactamente cuál es el récord o hecho principal.
2. Determina qué tipo de marca es: récord roto, récord igualado, récord de club, récord de competición, récord nacional, récord continental, récord mundial, hito estadístico, primera vez que ocurre algo o simplemente un dato extraordinario.
3. Identifica la nueva cifra.
4. Identifica la marca anterior.
5. Identifica quién tenía la marca anterior.
6. Identifica cuándo se consiguió la marca anterior.
7. Busca diferencias concretas entre ambas marcas.
8. Busca otros datos históricos relacionados.
9. Busca comparaciones que realmente aporten información.
10. Descarta cualquier dato que no puedas sostener con suficiente seguridad.

DENSIDAD DE INFORMACIÓN
Quiero muchos datos importantes, no mucho texto.
Cada diapositiva debe aportar INFORMACIÓN NUEVA.

Una diapositiva debería existir porque introduce al menos uno de estos elementos:
- un nuevo dato
- una nueva cifra
- una nueva comparación
- un nuevo antecedente
- una nueva marca
- una nueva perspectiva estadística
- una nueva parte de la cronología
- un nuevo contexto necesario para comprender el récord

Si una diapositiva no aporta información nueva importante, ELIMÍNALA.

PROHIBIDO EL RELLENO
No crees diapositivas solamente para alargar el video.
No uses frases vacías, opiniones genéricas o especulación para reemplazar datos.

Evita contenido como:
“Ahora tendrá más presión”.
“Habrá que ver hasta dónde llega”.
“Su futuro parece prometedor”.
“Todo el mundo hablará de él”.
“Este puede ser el inicio de algo grande”.
“Demostró que tiene mucho talento”.
“Será interesante seguir su carrera”.

Estas ideas solo pueden utilizarse si existe un hecho, declaración o información verificable que las sustente.
No sustituyas la falta de datos con opiniones.

NO REPETIR ENTRE DIAPOSITIVAS
MUY IMPORTANTE: no repitas contenido entre diapositivas.

Si una cifra, fecha, récord, comparación o explicación ya fue desarrollada, no vuelvas a crear otra diapositiva diciendo esencialmente lo mismo.
Cada nueva diapositiva debe avanzar la historia.
Puedes mencionar brevemente un dato anterior si es imprescindible para conectar una idea nueva, pero no vuelvas a desarrollarlo.
No hagas una diapositiva de “resumen” que simplemente repita todo lo anterior.
La última diapositiva puede cerrar la historia, pero debe ser breve y no reconstruir nuevamente todo el video.

EVITA REPETICIONES DENTRO DE LA MISMA DIAPOSITIVA
GANCHO, TITULO, CUERPO, CONTENIDO y LECTURA cumplen funciones diferentes.
No deben decir exactamente lo mismo cinco veces.

GANCHO: abre una pregunta, sorpresa o dato poderoso.
TITULO: identifica claramente el tema de la escena.
CUERPO: resume visualmente las ideas principales.
CONTENIDO: aporta cifras, fechas, comparaciones y datos adicionales.
LECTURA: explica y conecta esos datos de forma natural para el presentador.

NARRACIÓN
El video debe sentirse como una investigación contada de forma entretenida, no como una lista de estadísticas.

La historia puede avanzar, por ejemplo, así:
qué ocurrió → qué récord rompió → cuál era la marca anterior → comparación exacta → antecedentes históricos → otras marcas relacionadas → contexto estadístico → consecuencias reales del récord → cierre.

No uses esta secuencia obligatoriamente. Adáptala a los datos reales disponibles.

CANTIDAD DE DIAPOSITIVAS
NO existe un número obligatorio.
Si existen datos sólidos para 6 diapositivas, genera 6.
Si existen suficientes datos importantes para 15, genera 15.
Si existen suficientes datos importantes para 25, genera 25.
Nunca conviertas 6 diapositivas de información en 15 repitiendo o rellenando.

CTA
Incluye normalmente un CTA natural aproximadamente a mitad del video.
No interrumpas una parte especialmente importante de la historia solamente para colocar el CTA.
La última diapositiva debe utilizar CTA_TIPO=SUSCRIBIRSE.
El CTA final debe invitar naturalmente a seguir ${CHANNEL_PROFILE.name}.
No repitas llamadas a la acción constantemente.

FORMATO DE SALIDA
Devuelve ÚNICAMENTE el contenido que se pegará en Videos Studio.
No escribas “Aquí tienes el guion”, “Claro”, “Te preparé”, “Fuentes”, “Notas” ni explicaciones antes o después.
No utilices bloques de código Markdown.
No cambies los nombres de los campos.
No elimines ni modifiques los separadores ===.
Cada marcador ===...=== debe aparecer solo en su propia línea.
Numera las diapositivas consecutivamente desde 1.

FORMATO OBLIGATORIO

===DIAPOSITIVA 1===

===GANCHO===
[Gancho breve y potente]

===TITULO===
[Título corto y claro]

===CUERPO===
CUERPO_1=[Idea principal]
CUERPO_2=[Idea principal]
CUERPO_3=[Idea principal]

===CONTENIDO===
CONTENIDO_1=[Dato importante]
CONTENIDO_2=[Dato importante]
CONTENIDO_3=[Dato importante]

===LECTURA===
[Texto exacto y natural que leerá el presentador]
===FIN_LECTURA===

===VISUAL===
VISUAL_TIPO=[IMAGEN / COMPARATIVA / TABLA / GRAFICO_BARRAS / CRONOLOGIA / DIAGRAMA / NINGUNO]
VISUAL_DESCRIPCION=[Descripción exacta del recurso visual]
VISUAL_DATO_1=[Dato necesario para construir el visual]
VISUAL_DATO_2=[Dato necesario para construir el visual]
VISUAL_DATO_3=[Dato necesario para construir el visual]

===CTA===
CTA_TIPO=[NINGUNO / PREGUNTA / COMENTAR / LIKE / SUSCRIBIRSE / OTRO]
CTA_TEXTO=[Texto del CTA o vacío]

===FIN_DIAPOSITIVA 1===

CUERPO Y CONTENIDO
No estás limitado a tres elementos.
Si existen más datos importantes, puedes utilizar CUERPO_4, CUERPO_5, CUERPO_6, etc. y CONTENIDO_4, CONTENIDO_5, CONTENIDO_6, etc.
Prioriza la información importante sobre una cantidad fija de elementos.
No agregues elementos únicamente para llenar espacio.

VISUALES
El visual debe ayudar a entender el dato.

Utiliza IMAGEN para jugadores, partidos, estadios, celebraciones o momentos concretos.
Utiliza COMPARATIVA cuando exista una comparación clara entre dos o más marcas.
Utiliza GRAFICO_BARRAS cuando varias cifras sean fáciles de comparar.
Utiliza TABLA cuando existan varios jugadores, temporadas o estadísticas.
Utiliza CRONOLOGIA cuando la evolución histórica sea importante.
Utiliza DIAGRAMA cuando sea necesario explicar relaciones entre varios datos.
Utiliza NINGUNO solo cuando un recurso visual adicional realmente no aporte valor.

Cuando utilices COMPARATIVA, TABLA, GRAFICO_BARRAS, CRONOLOGIA o DIAGRAMA, incluye todos los datos necesarios en VISUAL_DATO_1, VISUAL_DATO_2, VISUAL_DATO_3, VISUAL_DATO_4, etc.

CONTROL FINAL ANTES DE RESPONDER
Antes de entregar el resultado, revisa mentalmente todas las diapositivas y comprueba:
1. ¿Hay algún dato inventado o dudoso? Si existe, elimínalo.
2. ¿Dos diapositivas cuentan prácticamente lo mismo? Si ocurre, fusiona o elimina una.
3. ¿Hay alguna diapositiva de relleno? Elimínala.
4. ¿Cada diapositiva aporta información factual nueva? Si no, elimínala.
5. ¿Hay datos importantes disponibles que todavía no has utilizado? Incorpóralos donde correspondan.
6. ¿CUERPO y CONTENIDO contienen información útil y no frases genéricas?
7. ¿La LECTURA explica los datos sin limitarse a repetir literalmente CUERPO y CONTENIDO?
8. ¿Los visuales contienen los datos necesarios para poder construirse?
9. ¿El CTA intermedio es natural?
10. ¿La última diapositiva cierra el video sin volver a repetir todos los datos anteriores?

IMPORTANTE FINAL
La prioridad de ${CHANNEL_PROFILE.name} es:
DATOS VERIFICADOS > CANTIDAD DE DIAPOSITIVAS.
INFORMACIÓN NUEVA > REPETICIÓN.
DATOS IMPORTANTES > RELLENO.
PRECISIÓN > ESPECTACULARIDAD.

Nunca inventes información para hacer que el video parezca más interesante.

Ahora utiliza el tema, noticia, enlace o información que te entregue y responde únicamente con las diapositivas en el formato indicado.`;

// Alias temporal para compatibilidad con módulos antiguos.
export const AI_FORMAT_RULES = AI_MASTER_PROMPT;

const VISUAL_TYPES = new Set(['IMAGEN', 'GRAFICO_BARRAS', 'TABLA', 'COMPARATIVA', 'CRONOLOGIA', 'DIAGRAMA', 'NINGUNO']);
const CTA_TYPES = new Set(['NINGUNO', 'SUSCRIBIRSE', 'COMENTAR', 'PREGUNTA', 'LIKE', 'OTRO']);
const DASHES = /[‐‑‒–—−]/g;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const INSTRUCTION_MARKERS = [
  'PROMPT MAESTRO',
  'ACTÚA COMO GUIONISTA',
  'REGLAS CRÍTICAS DE SALIDA',
  'FORMATO OBLIGATORIO PARA CADA DIAPOSITIVA',
  'REGLAS DE FORMATO PARA VIDEOS STUDIO',
  'CONTEXTO DEL CANAL',
  'OBJETIVO DE VIDEOS STUDIO',
  'REGLAS DE ESTRUCTURA',
  'PLANTILLA BASE DE SALIDA',
];

function normalizeCommonText(value = '') {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(UNICODE_SPACES, ' ')
    .replace(/\\([_*~`])/g, '$1');
}

function normalizedUpper(value = '') {
  return normalizeCommonText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function trimBlankLines(lines = []) {
  const copy = Array.isArray(lines) ? [...lines] : String(lines).split('\n');
  while (copy.length && !String(copy[0]).trim()) copy.shift();
  while (copy.length && !String(copy[copy.length - 1]).trim()) copy.pop();
  return copy.join('\n');
}

function canonicalType(value = '') {
  return normalizeCommonText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
}

function blockType(value = '') {
  const raw = String(value).match(/^\s*TIPO\s*:\s*([^\n]+)$/im)?.[1] || '';
  return canonicalType(raw);
}

function normalizeBulletLine(line = '') {
  let text = normalizeCommonText(line).trim();
  if (!text) return { text: '', bullet: false, changed: false };

  const original = text;
  text = text.replace(DASHES, '-');
  const match = text.match(/^[-•·▪◦●*]\s*(.+)$/u) || text.match(/^\d{1,2}[.)]\s+(.+)$/u);
  if (match) {
    const value = match[1].trim();
    return { text: `- ${value}`, bullet: Boolean(value), changed: original !== `- ${value}` };
  }

  // Si una IA o el portapapeles elimina la viñeta, CUERPO/CONTENIDO siguen siendo líneas independientes.
  return { text: `- ${text}`, bullet: true, changed: true };
}

function normalizeBulletBlock(value = '') {
  const rawLines = String(value).split('\n');
  const normalized = [];
  let changed = false;
  let nonEmpty = 0;
  let bulletCount = 0;

  rawLines.forEach((line) => {
    if (!line.trim()) return;
    nonEmpty += 1;
    const result = normalizeBulletLine(line);
    if (result.changed) changed = true;
    if (result.bullet) bulletCount += 1;
    normalized.push(result.text);
  });

  return {
    value: normalized.join('\n'),
    valid: nonEmpty > 0 && bulletCount === nonEmpty,
    changed,
    count: bulletCount,
  };
}

function ctaIsActive(cta = '') {
  const type = blockType(cta);
  if (type) return type !== 'NINGUNO';
  const normalized = canonicalType(cta);
  return !!normalized && normalized !== 'NINGUNO';
}

function normalizePoint(value = '') {
  return normalizeCommonText(value)
    .toLowerCase()
    .replace(/^[-•*]\s*/, '')
    .replace(/[^a-záéíóúüñ0-9%]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function duplicatePointCount(body = '', content = '') {
  const a = new Set(String(body).split('\n').map(normalizePoint).filter(Boolean));
  const b = String(content).split('\n').map(normalizePoint).filter(Boolean);
  return b.filter((point) => a.has(point)).length;
}

function wordCount(value = '') {
  return normalizeCommonText(value).trim().split(/\s+/).filter(Boolean).length;
}

function ctaMatchesReading(type, reading = '') {
  if (!type || type === 'NINGUNO') return true;
  const text = normalizeCommonText(reading).toLowerCase();
  const patterns = {
    SUSCRIBIRSE: /suscr[ií]b|suscrip|canal/,
    COMENTAR: /comenta|comentario|cu[eé]ntame|dime/,
    PREGUNTA: /\?|crees|qu[eé] opinas|cu[aá]l/,
    LIKE: /like|me gusta/,
    OTRO: /./,
  };
  return patterns[type]?.test(text) ?? true;
}

function looksLikeInstructionDocument(value = '') {
  const upper = normalizedUpper(value);
  const count = INSTRUCTION_MARKERS.filter((marker) => upper.includes(normalizedUpper(marker))).length;
  return upper.includes('PROMPT MAESTRO') || upper.includes('REGLAS DE FORMATO PARA VIDEOS STUDIO') || count >= 3;
}

function looksLikePlaceholderTemplate(value = '') {
  const text = normalizeCommonText(value);
  const placeholders = text.match(/\[[^\]\n]{1,180}\]/g) || [];
  return placeholders.length >= 3;
}

function structuredSlideMarker(line = '') {
  return normalizeCommonText(line).trim().match(/^={3,}\s*DIAPOSITIVA\s+(\d+)\s*={3,}$/i);
}

function extractEmbeddedStructuredScript(value = '') {
  const lines = normalizeCommonText(value).split('\n');
  const starts = [];
  lines.forEach((line, index) => {
    if (structuredSlideMarker(line)?.[1] === '1') starts.push(index);
  });

  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const candidate = lines.slice(starts[index]).join('\n').trim();
    if (!candidate || looksLikePlaceholderTemplate(candidate)) continue;
    const upper = normalizedUpper(candidate);
    if (INSTRUCTION_MARKERS.some((marker) => upper.includes(normalizedUpper(marker)))) continue;
    if (/===\s*GANCHO\s*===/i.test(candidate) && /===\s*LECTURA\s*===/i.test(candidate)) return candidate;
  }
  return '';
}

function extractEmbeddedLegacyScript(value = '') {
  const lines = normalizeCommonText(value).split('\n');
  const starts = [];
  lines.forEach((line, index) => {
    const clean = line.replace(/\*\*/g, '').trim().replace(/^#{1,6}\s*/, '');
    if (/^DIAPOSITIVA\s+1\s*$/i.test(clean)) starts.push(index);
  });

  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const candidate = lines.slice(starts[index]).join('\n').trim();
    if (!candidate || looksLikePlaceholderTemplate(candidate)) continue;
    const upper = normalizedUpper(candidate);
    if (INSTRUCTION_MARKERS.some((marker) => upper.includes(normalizedUpper(marker)))) continue;
    const fields = ['GANCHO:', 'TÍTULO:', 'CUERPO:', 'CONTENIDO:', 'LECTURA:', 'VISUAL:', 'CTA:'];
    const fieldCount = fields.filter((field) => upper.includes(normalizedUpper(field))).length;
    if (fieldCount >= 6) return candidate;
  }
  return '';
}

function finalizeSlide(current, slides, errors, warnings, corrections) {
  if (!current) return;

  const hook = trimBlankLines(current.hook);
  const title = trimBlankLines(current.title);
  const bodyRaw = trimBlankLines(current.body);
  const contentRaw = trimBlankLines(current.content);
  const reading = trimBlankLines(current.reading);
  const visual = trimBlankLines(current.visual);
  const cta = trimBlankLines(current.cta);

  const bodyNormalized = normalizeBulletBlock(bodyRaw);
  const contentNormalized = normalizeBulletBlock(contentRaw);
  const body = bodyNormalized.value || bodyRaw;
  const content = contentNormalized.value || contentRaw;
  const visualType = blockType(visual);
  const ctaType = blockType(cta);

  if (!Number.isFinite(current.number)) {
    errors.push('Se encontró una diapositiva sin número válido.');
    return;
  }

  if (bodyNormalized.changed && bodyRaw) corrections.push(`Diapositiva ${current.number}: Videos Studio normalizó CUERPO.`);
  if (contentNormalized.changed && contentRaw) corrections.push(`Diapositiva ${current.number}: Videos Studio normalizó CONTENIDO.`);

  if (!title) errors.push(`Diapositiva ${current.number}: falta TÍTULO.`);
  if (!body) errors.push(`Diapositiva ${current.number}: falta CUERPO.`);
  if (!content) errors.push(`Diapositiva ${current.number}: falta CONTENIDO.`);
  if (!reading) warnings.push(`Diapositiva ${current.number}: falta LECTURA. No podrás grabarla hasta agregarla.`);

  if (!visual) warnings.push(`Diapositiva ${current.number}: falta VISUAL.`);
  else if (!visualType) warnings.push(`Diapositiva ${current.number}: VISUAL no indica TIPO.`);
  else if (!VISUAL_TYPES.has(visualType)) warnings.push(`Diapositiva ${current.number}: TIPO de VISUAL no reconocido: ${visualType}.`);

  if (!cta) warnings.push(`Diapositiva ${current.number}: falta CTA.`);
  else if (!ctaType) warnings.push(`Diapositiva ${current.number}: CTA no indica TIPO.`);
  else if (!CTA_TYPES.has(ctaType)) warnings.push(`Diapositiva ${current.number}: TIPO de CTA no reconocido: ${ctaType}.`);

  if (duplicatePointCount(body, content) > 0) warnings.push(`Diapositiva ${current.number}: CUERPO y CONTENIDO repiten información.`);
  if (title.length > 85) warnings.push(`Diapositiva ${current.number}: TÍTULO es demasiado largo para una composición visual limpia.`);
  if (hook.length > 200) warnings.push(`Diapositiva ${current.number}: GANCHO es largo; conviene hacerlo más directo.`);

  if (ctaIsActive(cta) && CTA_TYPES.has(ctaType) && !ctaMatchesReading(ctaType, reading)) {
    warnings.push(`Diapositiva ${current.number}: el CTA ${ctaType} no parece estar integrado en la LECTURA.`);
  }

  slides.push({
    number: current.number,
    hook,
    title,
    body,
    content,
    reading,
    visual,
    cta,
    visualType,
    ctaType,
    validation: {
      hook: !!hook,
      title: !!title,
      body: !!body,
      content: !!content,
      reading: !!reading,
      visual: !!visual,
      cta: ctaIsActive(cta),
      bodyBulleted: !!body,
      contentBulleted: !!content,
      readingWords: wordCount(reading),
    },
  });
}

function validateStoryStructure(slides, errors, warnings) {
  if (!slides.length) return;

  slides.forEach((slide, index) => {
    const expected = index + 1;
    if (slide.number !== expected) errors.push(`La numeración debe ser consecutiva. Se esperaba DIAPOSITIVA ${expected} y se encontró DIAPOSITIVA ${slide.number}.`);
  });

  if (!slides[0].hook?.trim()) warnings.push(`La primera diapositiva no tiene GANCHO. Un video de ${CHANNEL_PROFILE.name} debería abrir con una razón clara para seguir mirando.`);

  if (slides.length >= 3) {
    const middleIndex = Math.floor((slides.length - 1) / 2);
    const candidates = slides.slice(Math.max(0, middleIndex - 1), Math.min(slides.length, middleIndex + 2));
    if (!candidates.some((slide) => ctaIsActive(slide.cta))) warnings.push('Falta un CTA intermedio aproximadamente a la mitad del video.');
  }

  const last = slides[slides.length - 1];
  if (last.ctaType !== 'SUSCRIBIRSE') warnings.push(`Diapositiva ${last.number}: el CTA final debería ser TIPO: SUSCRIBIRSE para ${CHANNEL_PROFILE.name}.`);

  const titleKeys = new Map();
  for (const slide of slides) {
    const key = normalizePoint(slide.title);
    if (!key) continue;
    if (titleKeys.has(key)) warnings.push(`Diapositiva ${slide.number}: el TÍTULO repite el de la diapositiva ${titleKeys.get(key)}.`);
    else titleKeys.set(key, slide.number);
  }
}

function newCurrent(number) {
  return { number, hook: [], title: [], body: [], content: [], reading: [], visual: [], cta: [] };
}

function parseStructuredSlides(normalized, initialCorrections = []) {
  const lines = normalized.split('\n');
  const slides = [];
  const errors = [];
  const warnings = [];
  const corrections = [...initialCorrections];
  let current = null;
  let section = null;
  let currentNumber = null;

  const pushCurrent = () => {
    if (!current) return;
    finalizeSlide(current, slides, errors, warnings, corrections);
    current = null;
    section = null;
    currentNumber = null;
  };

  for (const originalLine of lines) {
    const line = normalizeCommonText(originalLine);
    const trimmed = line.trim();
    const slideStart = structuredSlideMarker(trimmed);
    if (slideStart) {
      if (current) pushCurrent();
      currentNumber = Number(slideStart[1]);
      current = newCurrent(currentNumber);
      section = null;
      continue;
    }

    const slideEnd = trimmed.match(/^={3,}\s*FIN[_\s-]*DIAPOSITIVA(?:\s+(\d+))?\s*={3,}$/i);
    if (slideEnd) {
      if (current && slideEnd[1] && Number(slideEnd[1]) !== currentNumber) warnings.push(`Diapositiva ${currentNumber}: el marcador final indica ${slideEnd[1]}.`);
      pushCurrent();
      continue;
    }

    if (!current) continue;

    const sectionMarker = trimmed.match(/^={3,}\s*(GANCHO|T[IÍ]TULO|CUERPO|CONTENIDO|LECTURA|VISUAL|CTA)\s*={3,}$/i);
    if (sectionMarker) {
      const key = canonicalType(sectionMarker[1]);
      section = ({ GANCHO: 'hook', TITULO: 'title', CUERPO: 'body', CONTENIDO: 'content', LECTURA: 'reading', VISUAL: 'visual', CTA: 'cta' })[key] || null;
      continue;
    }

    if (/^={3,}\s*FIN[_\s-]*LECTURA\s*={3,}$/i.test(trimmed)) {
      if (section === 'reading') section = null;
      continue;
    }

    if (!section || !trimmed) {
      if (section === 'reading') current.reading.push(line);
      continue;
    }

    if (section === 'body') {
      const match = trimmed.match(/^CUERPO_(\d+)\s*[:=]\s*(.*)$/i);
      const value = (match?.[2] ?? trimmed).trim();
      if (value) current.body.push(`- ${value}`);
      if (!match && value) corrections.push(`Diapositiva ${currentNumber}: se recuperó una línea de CUERPO sin etiqueta CUERPO_X.`);
      continue;
    }

    if (section === 'content') {
      const match = trimmed.match(/^CONTENIDO_(\d+)\s*[:=]\s*(.*)$/i);
      const value = (match?.[2] ?? trimmed).trim();
      if (value) current.content.push(`- ${value}`);
      if (!match && value) corrections.push(`Diapositiva ${currentNumber}: se recuperó una línea de CONTENIDO sin etiqueta CONTENIDO_X.`);
      continue;
    }

    if (section === 'visual') {
      let match = trimmed.match(/^VISUAL_TIPO\s*[:=]\s*(.*)$/i);
      if (match) { current.visual.push(`TIPO: ${canonicalType(match[1])}`); continue; }
      match = trimmed.match(/^VISUAL_DESCRIPCI[ÓO]N\s*[:=]\s*(.*)$/i);
      if (match) { current.visual.push(`DESCRIPCIÓN: ${match[1].trim()}`); continue; }
      match = trimmed.match(/^VISUAL_DATO_(\d+)\s*[:=]\s*(.*)$/i);
      if (match) { current.visual.push(`Dato ${match[1]}: ${match[2].trim()}`); continue; }
      current.visual.push(line);
      continue;
    }

    if (section === 'cta') {
      let match = trimmed.match(/^CTA_TIPO\s*[:=]\s*(.*)$/i);
      if (match) { current.cta.push(`TIPO: ${canonicalType(match[1])}`); continue; }
      match = trimmed.match(/^CTA_TEXTO\s*[:=]\s*(.*)$/i);
      if (match) { current.cta.push(`TEXTO: ${match[1].trim()}`); continue; }
      current.cta.push(line);
      continue;
    }

    current[section].push(line);
  }

  if (current) pushCurrent();
  if (!slides.length) errors.push('No se detectaron diapositivas válidas. El guion debe comenzar con ===DIAPOSITIVA 1===.');
  validateStoryStructure(slides, errors, warnings);

  const uniqueCorrections = [...new Set(corrections)];
  if (uniqueCorrections.length) warnings.unshift(`Videos Studio corrigió automáticamente ${uniqueCorrections.length} detalle${uniqueCorrections.length === 1 ? '' : 's'} de formato.`);

  return {
    slides,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    corrections: uniqueCorrections,
    inputKind: 'structured-script',
  };
}

function parseLegacySlides(normalized, initialCorrections = []) {
  const lines = normalized.split('\n');
  const slides = [];
  const errors = [];
  const warnings = [];
  const corrections = [...initialCorrections];
  let current = null;
  let section = null;
  const outsideText = [];

  const pushCurrent = () => {
    finalizeSlide(current, slides, errors, warnings, corrections);
    current = null;
    section = null;
  };

  for (const originalLine of lines) {
    const line = normalizeCommonText(originalLine);
    const matchable = line.replace(/\*\*/g, '');
    const trimmed = matchable.trim().replace(/^#{1,6}\s*/, '');
    const slideMatch = trimmed.match(/^DIAPOSITIVA\s+(\d+)\s*$/i);

    if (slideMatch) {
      if (current) pushCurrent();
      current = newCurrent(Number(slideMatch[1]));
      section = null;
      continue;
    }

    if (/^\/{2,}\s*$/.test(trimmed)) {
      if (current) pushCurrent();
      continue;
    }

    if (!current) {
      if (trimmed && !/^```(?:text|txt|markdown)?\s*$/i.test(trimmed)) outsideText.push(line);
      continue;
    }

    const fieldMatchers = [
      ['hook', /^\s*GANCHO\s*:\s*(.*)$/i],
      ['title', /^\s*T[IÍ]TULO\s*:\s*(.*)$/i],
      ['body', /^\s*CUERPO\s*:\s*(.*)$/i],
      ['content', /^\s*CONTENIDO\s*:\s*(.*)$/i],
      ['reading', /^\s*LECTURA\s*:\s*(.*)$/i],
      ['visual', /^\s*VISUAL\s*:\s*(.*)$/i],
      ['cta', /^\s*CTA\s*:\s*(.*)$/i],
    ];

    let matched = false;
    for (const [key, matcher] of fieldMatchers) {
      const match = matchable.match(matcher);
      if (!match) continue;
      section = key;
      if (match[1]) current[key].push(match[1]);
      matched = true;
      break;
    }
    if (matched) continue;

    if (/^```\s*$/.test(trimmed)) continue;
    if (section) current[section].push(line);
    else if (trimmed) warnings.push(`Diapositiva ${current.number}: texto fuera de los campos reconocidos: “${trimmed}”.`);
  }

  if (current) pushCurrent();
  if (outsideText.length) warnings.push('Se encontró texto fuera de las diapositivas y se ignoró.');
  if (!slides.length) errors.push('No se detectaron diapositivas. Usa el formato generado por el prompt de Videos Studio.');
  validateStoryStructure(slides, errors, warnings);

  const uniqueCorrections = [...new Set(corrections)];
  if (uniqueCorrections.length) warnings.unshift(`Videos Studio corrigió automáticamente ${uniqueCorrections.length} detalle${uniqueCorrections.length === 1 ? '' : 's'} de formato.`);

  return {
    slides,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    corrections: uniqueCorrections,
    inputKind: 'legacy-script',
  };
}

export function parseSlides(rawText = '') {
  let normalized = normalizeCommonText(rawText).trim();
  const corrections = [];

  if (!normalized) {
    return { slides: [], errors: ['No hay contenido para procesar.'], warnings: [], corrections: [], inputKind: 'empty' };
  }

  if (looksLikeInstructionDocument(normalized)) {
    const structured = extractEmbeddedStructuredScript(normalized);
    const legacy = structured ? '' : extractEmbeddedLegacyScript(normalized);
    if (structured) {
      normalized = structured;
      corrections.push('Videos Studio detectó el prompt mezclado con la respuesta y extrajo automáticamente el guion estructurado.');
    } else if (legacy) {
      normalized = legacy;
      corrections.push('Videos Studio detectó instrucciones mezcladas con la respuesta y extrajo automáticamente el guion.');
    } else {
      return {
        slides: [],
        errors: [`Pegaste el prompt de ${CHANNEL_PROFILE.name}, no la respuesta de la IA. Pega el prompt en ChatGPT y luego copia aquí únicamente el guion que ChatGPT genere.`],
        warnings: [],
        corrections: [],
        inputKind: 'prompt',
      };
    }
  }

  if (looksLikePlaceholderTemplate(normalized)) {
    return {
      slides: [],
      errors: ['Pegaste una plantilla sin completar. Pega aquí el guion ya generado por la IA.'],
      warnings: [],
      corrections: [],
      inputKind: 'template',
    };
  }

  if (/^={3,}\s*DIAPOSITIVA\s+\d+\s*={3,}$/im.test(normalized)) return parseStructuredSlides(normalized, corrections);
  return parseLegacySlides(normalized, corrections);
}
