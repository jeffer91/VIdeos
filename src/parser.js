import { CHANNEL_PROFILE } from './channel.js';

export const AI_FORMAT_RULES = `PROMPT MAESTRO · ${CHANNEL_PROFILE.name} · Videos Studio

Actúa como guionista, editor de estructura y verificador de datos para el canal ${CHANNEL_PROFILE.name}, dedicado a récords, marcas históricas, récords recién rotos y datos extraordinarios del fútbol mundial.

TU TAREA
Cuando te dé un tema, noticia, jugador, club, competición o récord, conviértelo en un guion largo de YouTube dividido en diapositivas listas para Videos Studio.

Antes de escribir:
- Verifica qué ocurrió y qué tipo de récord o hito es.
- Distingue entre récord roto, igualado, récord de club, competición, nacional, mundial o simple hito estadístico.
- No inventes cifras, fechas, edades, goles, asistencias, partidos, marcas anteriores ni declaraciones.
- Si un dato no está confirmado, no lo presentes como hecho.
- Cuando exista información fiable, explica quién tenía el récord anterior y por qué la nueva marca importa.

ESTILO DE ${CHANNEL_PROFILE.name.toUpperCase()}
- Narración clara, dinámica, humana y fácil de seguir.
- Cada diapositiva debe aportar algo nuevo: dato, contexto, comparación, consecuencia o proyección.
- Evita repetir la misma información entre CUERPO, CONTENIDO y diapositivas consecutivas.
- CUERPO = ideas principales que verá el espectador.
- CONTENIDO = cifras, edades, fechas, comparaciones o contexto que complementa el CUERPO.
- LECTURA = texto exacto del teleprompter; debe sonar como una persona contando una historia.
- VISUAL = recurso que realmente ayude a entender el dato, no simple decoración.
- Incluye un CTA natural aproximadamente a la mitad del video y uno de SUSCRIBIRSE en la última diapositiva.

CONTRATO DE SALIDA
Devuelve SOLAMENTE el guion. No escribas introducciones, explicaciones, notas, comentarios ni bloques de código.
Comienza directamente con DIAPOSITIVA 1.
Numera de forma consecutiva: DIAPOSITIVA 1, DIAPOSITIVA 2, DIAPOSITIVA 3...
Separa cada diapositiva con una línea que contenga únicamente //.
Usa SIEMPRE y en este orden: GANCHO, TÍTULO, CUERPO, CONTENIDO, LECTURA, VISUAL y CTA.

FORMATO EXACTO

DIAPOSITIVA 1

GANCHO:
[Frase breve, potente y distinta del título]

TÍTULO:
[Título corto y claro]

CUERPO:
- [Idea principal 1]
- [Idea principal 2]
- [Idea principal 3]

CONTENIDO:
- [Dato o contexto 1]
- [Dato o contexto 2]
- [Dato o contexto 3]

LECTURA:
[Texto natural del teleprompter. Explica qué ocurrió, por qué importa y da contexto a las cifras principales.]

VISUAL:
TIPO: IMAGEN
DESCRIPCIÓN: [Describe el apoyo visual.]

CTA:
TIPO: NINGUNO
TEXTO:

//

TIPOS DE VISUAL PERMITIDOS
IMAGEN, GRAFICO_BARRAS, TABLA, COMPARATIVA, CRONOLOGIA, DIAGRAMA, NINGUNO.
Si usas gráfico, tabla, comparativa, cronología o diagrama, añade dentro de VISUAL los datos necesarios para construirlo.

TIPOS DE CTA PERMITIDOS
NINGUNO, SUSCRIBIRSE, COMENTAR, PREGUNTA, LIKE, OTRO.
Si CTA es distinto de NINGUNO, intégralo también de forma natural dentro de LECTURA.
La última diapositiva debe usar TIPO: SUSCRIBIRSE y, cuando sea natural, mencionar ${CHANNEL_PROFILE.name}.

REGLA FINAL
No alargues artificialmente una historia sencilla y no comprimas una historia compleja. El objetivo es que cada diapositiva tenga una razón clara de existir y que el espectador entienda por qué el dato es extraordinario.

IMPORTANTE PARA VIDEOS STUDIO
Este prompt se pega en ChatGPT u otra IA. Después, copia únicamente la respuesta generada que empieza con DIAPOSITIVA 1 y pégala en Videos Studio.`;

const VISUAL_TYPES = new Set(['IMAGEN', 'GRAFICO_BARRAS', 'TABLA', 'COMPARATIVA', 'CRONOLOGIA', 'DIAGRAMA', 'NINGUNO']);
const CTA_TYPES = new Set(['NINGUNO', 'SUSCRIBIRSE', 'COMENTAR', 'PREGUNTA', 'LIKE', 'OTRO']);
const DASHES = /[‐‑‒–—−]/g;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const PROMPT_MARKERS = [
  'PROMPT MAESTRO',
  'TU TAREA',
  'ESTILO DE',
  'CONTRATO DE SALIDA',
  'FORMATO EXACTO',
  'TIPOS DE VISUAL PERMITIDOS',
  'TIPOS DE CTA PERMITIDOS',
  'IMPORTANTE PARA VIDEOS STUDIO',
  'REGLAS DE FORMATO PARA VIDEOS STUDIO',
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
  if (!text) return { text: '', bullet: false, changed: false, added: false };

  const original = text;
  text = text.replace(DASHES, '-');

  const bulletMatchers = [
    /^[-•·▪◦●*]\s*(.+)$/u,
    /^\d{1,2}[.)]\s+(.+)$/u,
  ];

  for (const matcher of bulletMatchers) {
    const match = text.match(matcher);
    if (!match) continue;
    const value = match[1].trim();
    const canonical = `- ${value}`;
    return { text: canonical, bullet: Boolean(value), changed: original !== canonical, added: false };
  }

  // CUERPO y CONTENIDO son listas por definición. Si al pegar desde una IA o
  // portapapeles enriquecido desaparecen las viñetas, Videos Studio las recupera.
  return { text: `- ${text}`, bullet: true, changed: true, added: true };
}

function normalizeBulletBlock(value = '') {
  const rawLines = String(value).split('\n');
  const normalized = [];
  let changed = false;
  let nonEmpty = 0;
  let bulletCount = 0;
  let autoAdded = 0;

  rawLines.forEach((line) => {
    if (!line.trim()) return;
    nonEmpty += 1;
    const result = normalizeBulletLine(line);
    if (result.changed) changed = true;
    if (result.bullet) bulletCount += 1;
    if (result.added) autoAdded += 1;
    normalized.push(result.text);
  });

  return {
    value: normalized.join('\n'),
    valid: nonEmpty > 0 && bulletCount === nonEmpty,
    changed,
    count: bulletCount,
    autoAdded,
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

function looksLikePromptDocument(value = '') {
  const upper = normalizedUpper(value);
  const markerCount = PROMPT_MARKERS.filter((marker) => upper.includes(normalizedUpper(marker))).length;
  return upper.includes('PROMPT MAESTRO') || upper.includes('REGLAS DE FORMATO PARA VIDEOS STUDIO') || markerCount >= 3;
}

function looksLikePlaceholderTemplate(value = '') {
  const text = normalizeCommonText(value);
  const placeholders = text.match(/\[[^\]\n]{1,180}\]/g) || [];
  const requiredFields = ['GANCHO:', 'TÍTULO:', 'CUERPO:', 'CONTENIDO:', 'LECTURA:', 'VISUAL:', 'CTA:'];
  const fieldCount = requiredFields.filter((field) => normalizedUpper(text).includes(normalizedUpper(field))).length;
  return placeholders.length >= 3 && fieldCount >= 5;
}

function hasPromptMarkersAfterSlideStart(candidate = '') {
  const upper = normalizedUpper(candidate);
  return PROMPT_MARKERS.some((marker) => upper.includes(normalizedUpper(marker)));
}

function extractEmbeddedScriptFromPrompt(value = '') {
  const lines = normalizeCommonText(value).split('\n');
  const starts = [];

  lines.forEach((line, index) => {
    const clean = line.replace(/\*\*/g, '').trim().replace(/^#{1,6}\s*/, '');
    if (/^DIAPOSITIVA\s+1\s*$/i.test(clean)) starts.push(index);
  });

  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const candidate = lines.slice(starts[index]).join('\n').trim();
    if (!candidate) continue;
    if (looksLikePlaceholderTemplate(candidate)) continue;
    if (hasPromptMarkersAfterSlideStart(candidate)) continue;

    const upper = normalizedUpper(candidate);
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

  if (bodyNormalized.changed) {
    const detail = bodyNormalized.autoAdded ? ' y recuperó puntos que habían perdido la viñeta' : '';
    corrections.push(`Diapositiva ${current.number}: se normalizó CUERPO${detail}.`);
  }
  if (contentNormalized.changed) {
    const detail = contentNormalized.autoAdded ? ' y recuperó puntos que habían perdido la viñeta' : '';
    corrections.push(`Diapositiva ${current.number}: se normalizó CONTENIDO${detail}.`);
  }

  if (!title) errors.push(`Diapositiva ${current.number}: falta TÍTULO.`);
  if (!body) errors.push(`Diapositiva ${current.number}: falta CUERPO.`);
  if (!content) errors.push(`Diapositiva ${current.number}: falta CONTENIDO.`);

  const bodyBulleted = !body || bodyNormalized.valid;
  const contentBulleted = !content || contentNormalized.valid;
  if (body && !bodyBulleted) errors.push(`Diapositiva ${current.number}: no se pudo interpretar CUERPO.`);
  if (content && !contentBulleted) errors.push(`Diapositiva ${current.number}: no se pudo interpretar CONTENIDO.`);
  if (!reading) warnings.push(`Diapositiva ${current.number}: falta LECTURA. No podrás grabarla hasta agregarla.`);

  if (!visual) warnings.push(`Diapositiva ${current.number}: falta VISUAL. Usa al menos “TIPO: NINGUNO”.`);
  else if (!visualType) warnings.push(`Diapositiva ${current.number}: VISUAL no indica TIPO.`);
  else if (!VISUAL_TYPES.has(visualType)) warnings.push(`Diapositiva ${current.number}: TIPO de VISUAL no reconocido: ${visualType}.`);

  if (!cta) warnings.push(`Diapositiva ${current.number}: falta CTA. Usa al menos “TIPO: NINGUNO”.`);
  else if (!ctaType) warnings.push(`Diapositiva ${current.number}: CTA no indica TIPO.`);
  else if (!CTA_TYPES.has(ctaType)) warnings.push(`Diapositiva ${current.number}: TIPO de CTA no reconocido: ${ctaType}.`);

  if (duplicatePointCount(body, content) > 0) warnings.push(`Diapositiva ${current.number}: CUERPO y CONTENIDO repiten información. Conviene usar CONTENIDO para aportar datos nuevos.`);

  const readingWords = wordCount(reading);
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
      bodyBulleted,
      contentBulleted,
      readingWords,
    },
  });
}

function validateStoryStructure(slides, errors, warnings) {
  if (!slides.length) return;

  slides.forEach((slide, index) => {
    const expected = index + 1;
    if (slide.number !== expected) {
      errors.push(`La numeración debe ser consecutiva. Se esperaba DIAPOSITIVA ${expected} y se encontró DIAPOSITIVA ${slide.number}.`);
    }
  });

  if (!slides[0].hook?.trim()) {
    warnings.push(`La primera diapositiva no tiene GANCHO. Un video de ${CHANNEL_PROFILE.name} debería abrir con una razón clara para seguir mirando.`);
  }

  if (slides.length >= 3) {
    const middleIndex = Math.floor((slides.length - 1) / 2);
    const candidates = slides.slice(Math.max(0, middleIndex - 1), Math.min(slides.length, middleIndex + 2));
    if (!candidates.some((slide) => ctaIsActive(slide.cta))) {
      warnings.push('Falta un CTA intermedio aproximadamente a la mitad del video.');
    }
  }

  const last = slides[slides.length - 1];
  if (last.ctaType !== 'SUSCRIBIRSE') {
    warnings.push(`Diapositiva ${last.number}: el CTA final debería ser TIPO: SUSCRIBIRSE para ${CHANNEL_PROFILE.name}.`);
  }

  const titleKeys = new Map();
  for (const slide of slides) {
    const key = normalizePoint(slide.title);
    if (!key) continue;
    if (titleKeys.has(key)) warnings.push(`Diapositiva ${slide.number}: el TÍTULO repite el de la diapositiva ${titleKeys.get(key)}.`);
    else titleKeys.set(key, slide.number);
  }
}

export function parseSlides(rawText = '') {
  const corrections = [];
  let normalized = normalizeCommonText(rawText).trim();

  if (!normalized) {
    return {
      slides: [],
      errors: ['No hay contenido para procesar.'],
      warnings: [],
      corrections: [],
      inputKind: 'empty',
    };
  }

  const promptDetected = looksLikePromptDocument(normalized);
  if (promptDetected) {
    const embeddedScript = extractEmbeddedScriptFromPrompt(normalized);
    if (embeddedScript) {
      normalized = embeddedScript;
      corrections.push('Videos Studio detectó el prompt mezclado con el guion y extrajo automáticamente las diapositivas reales.');
    } else {
      return {
        slides: [],
        errors: [`Pegaste el prompt de ${CHANNEL_PROFILE.name}, no el guion generado. Pega este prompt en ChatGPT y luego pega aquí únicamente la respuesta que empieza por “DIAPOSITIVA 1”.`],
        warnings: [],
        corrections: [],
        inputKind: 'prompt',
      };
    }
  } else if (looksLikePlaceholderTemplate(normalized)) {
    return {
      slides: [],
      errors: ['Pegaste una plantilla sin completar. Pega el guion generado por la IA, no la plantilla de ejemplo.'],
      warnings: [],
      corrections: [],
      inputKind: 'template',
    };
  }

  const lines = normalized.split('\n');
  const slides = [];
  const errors = [];
  const warnings = [];

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
      current = {
        number: Number(slideMatch[1]),
        hook: [],
        title: [],
        body: [],
        content: [],
        reading: [],
        visual: [],
        cta: [],
      };
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
  if (!slides.length) errors.push('No se detectaron diapositivas. Usa bloques que empiecen con “DIAPOSITIVA 1”, “DIAPOSITIVA 2”, etc.');

  const seen = new Set();
  for (const slide of slides) {
    if (seen.has(slide.number)) errors.push(`El número de diapositiva ${slide.number} está repetido.`);
    seen.add(slide.number);
  }

  validateStoryStructure(slides, errors, warnings);

  const uniqueCorrections = [...new Set(corrections)];
  if (uniqueCorrections.length) {
    warnings.unshift(`Videos Studio corrigió automáticamente ${uniqueCorrections.length} detalle${uniqueCorrections.length === 1 ? '' : 's'} de formato al pegar el guion.`);
  }

  return {
    slides,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    corrections: uniqueCorrections,
    inputKind: 'script',
  };
}
