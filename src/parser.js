import { CHANNEL_PROFILE } from './channel.js';

export const AI_FORMAT_RULES = `REGLAS DE FORMATO PARA VIDEOS STUDIO · ${CHANNEL_PROFILE.name}

IMPORTANTE
Estas reglas son para pegarlas en ChatGPT u otra IA. NO pegues este documento de reglas de vuelta en Videos Studio. En Videos Studio debes pegar únicamente la respuesta generada, comenzando directamente con DIAPOSITIVA 1.

CONTEXTO DEL CANAL
Canal: ${CHANNEL_PROFILE.name}
Tema principal: récords, marcas históricas, récords recién rotos y datos extraordinarios del fútbol mundial.
Objetivo: producir videos largos de YouTube claros, dinámicos y verificables. Prioriza datos concretos, contexto, comparación y relevancia del récord. No inventes cifras, edades, fechas, goles, asistencias ni marcas. Si un dato no está confirmado, no lo presentes como hecho.

OBJETIVO DE VIDEOS STUDIO
Genera un video por diapositivas usando EXACTAMENTE la estructura indicada. No cambies los nombres de los campos. Cada diapositiva debe funcionar como una escena independiente pero mantener continuidad con la anterior.

FORMATO OBLIGATORIO

DIAPOSITIVA 1
GANCHO:
Frase breve y potente que capte la atención al comenzar esta parte del video.

TÍTULO:
Título corto de la diapositiva

CUERPO:
- Punto visual 1.
- Punto visual 2.
- Punto visual 3.

CONTENIDO:
- Dato, cifra o idea complementaria 1.
- Dato, cifra o idea complementaria 2.
- Dato, cifra o idea complementaria 3.

LECTURA:
Texto exacto que debe leer el presentador durante la grabación. Puede ser uno o varios párrafos naturales.

VISUAL:
TIPO: IMAGEN
DESCRIPCIÓN: Describe la imagen, gráfico, tabla, comparativa, cronología o recurso que ayudará a entender esta diapositiva.

CTA:
TIPO: NINGUNO
TEXTO:

//

REGLAS DE ESTRUCTURA
1. Cada bloque comienza con DIAPOSITIVA seguido de su número consecutivo: 1, 2, 3, 4...
2. Usa siempre GANCHO, TÍTULO, CUERPO, CONTENIDO, LECTURA, VISUAL y CTA.
3. CUERPO y CONTENIDO son lo que verá el espectador y deben ir por puntos. Usa preferentemente guion: - Punto.
4. CUERPO resume las ideas principales; CONTENIDO aporta cifras, contexto o datos complementarios. Evita repetir exactamente lo mismo en ambos.
5. LECTURA es únicamente lo que leerá el presentador en el prompter. No pongas instrucciones de cámara, edición ni gestos.
6. Mantén coherencia factual entre TÍTULO, CUERPO, CONTENIDO, LECTURA y VISUAL.
7. Si mencionas una cifra importante en CUERPO o CONTENIDO, procura explicarla también en LECTURA.
8. VISUAL puede ser: IMAGEN, GRAFICO_BARRAS, TABLA, COMPARATIVA, CRONOLOGIA, DIAGRAMA o NINGUNO.
9. Si VISUAL es gráfico, tabla, comparativa, cronología o diagrama, incluye los datos necesarios en líneas claras dentro del bloque VISUAL.
10. CTA puede ser: NINGUNO, SUSCRIBIRSE, COMENTAR, PREGUNTA, LIKE u OTRO.
11. La primera diapositiva debe tener un GANCHO fuerte y presentar rápidamente por qué el récord importa.
12. Aproximadamente a la mitad del video incluye un CTA natural. No repitas CTA en exceso.
13. La última diapositiva debe usar CTA TIPO: SUSCRIBIRSE y ser coherente con la LECTURA.
14. Cuando sea natural, el CTA final debe mencionar ${CHANNEL_PROFILE.name}.
15. Separa cada diapositiva con una línea que contenga únicamente //.
16. No omitas VISUAL ni CTA. Si no hacen falta, usa TIPO: NINGUNO.
17. Devuelve solamente las diapositivas en este formato, sin explicaciones antes ni después.

CRITERIO EDITORIAL DE ${CHANNEL_PROFILE.name.toUpperCase()}
- Prioriza récords realmente llamativos y fáciles de entender.
- Explica quién tenía el récord anterior y por qué la nueva marca es relevante cuando ese dato exista.
- Evita exageraciones que contradigan las cifras.
- No llames “récord mundial”, “récord histórico” o “primero de la historia” a algo si el dato no está sustentado.
- Los títulos deben ser claros y atractivos, no una repetición literal de la LECTURA.
- La narración debe sonar humana y fluida, no como una lista de estadísticas.`;

const VISUAL_TYPES = new Set(['IMAGEN', 'GRAFICO_BARRAS', 'TABLA', 'COMPARATIVA', 'CRONOLOGIA', 'DIAGRAMA', 'NINGUNO']);
const CTA_TYPES = new Set(['NINGUNO', 'SUSCRIBIRSE', 'COMENTAR', 'PREGUNTA', 'LIKE', 'OTRO']);
const DASHES = /[‐‑‒–—−]/g;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const UNICODE_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const RULE_MARKERS = [
  'REGLAS DE FORMATO PARA VIDEOS STUDIO',
  'CONTEXTO DEL CANAL',
  'OBJETIVO DE VIDEOS STUDIO',
  'REGLAS DE ESTRUCTURA',
  'CRITERIO EDITORIAL',
  'VERIFICACIÓN DE DATOS',
  'ESTILO DE NARRACIÓN',
  'ESTRUCTURA NARRATIVA RECOMENDADA',
  'REGLA FINAL DE SALIDA',
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

  const bulletMatchers = [
    /^[-•·▪◦●*]\s*(.+)$/u,
    /^\d{1,2}[.)]\s+(.+)$/u,
  ];

  for (const matcher of bulletMatchers) {
    const match = text.match(matcher);
    if (!match) continue;
    const value = match[1].trim();
    const standardHyphen = /^-\s+\S/u.test(original);
    return { text: `- ${value}`, bullet: Boolean(value), changed: !standardHyphen && original !== `- ${value}` };
  }

  return { text, bullet: false, changed: original !== text };
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

function visualHasSupportingData(visual = '') {
  const useful = normalizeCommonText(visual)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^TIPO\s*:/i.test(line) && !/^DESCRIPCI[ÓO]N\s*:/i.test(line));
  return useful.length > 0;
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

function looksLikeRulesDocument(value = '') {
  const upper = normalizedUpper(value);
  const markerCount = RULE_MARKERS.filter((marker) => upper.includes(normalizedUpper(marker))).length;
  return upper.includes('REGLAS DE FORMATO PARA VIDEOS STUDIO') || markerCount >= 3;
}

function looksLikePlaceholderTemplate(value = '') {
  const text = normalizeCommonText(value);
  const placeholders = text.match(/\[[^\]\n]{1,140}\]/g) || [];
  const requiredFields = ['GANCHO:', 'TÍTULO:', 'CUERPO:', 'CONTENIDO:', 'LECTURA:', 'VISUAL:', 'CTA:'];
  const fieldCount = requiredFields.filter((field) => normalizedUpper(text).includes(normalizedUpper(field))).length;
  return placeholders.length >= 3 && fieldCount >= 5;
}

function hasRuleMarkersAfterSlideStart(candidate = '') {
  const upper = normalizedUpper(candidate);
  return RULE_MARKERS.some((marker) => upper.includes(normalizedUpper(marker)));
}

function extractEmbeddedScriptFromRules(value = '') {
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
    if (hasRuleMarkersAfterSlideStart(candidate)) continue;

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

  if (bodyNormalized.changed) corrections.push(`Diapositiva ${current.number}: se normalizó el formato de CUERPO.`);
  if (contentNormalized.changed) corrections.push(`Diapositiva ${current.number}: se normalizó el formato de CONTENIDO.`);

  if (!title) errors.push(`Diapositiva ${current.number}: falta TÍTULO.`);
  if (!body) errors.push(`Diapositiva ${current.number}: falta CUERPO.`);
  if (!content) errors.push(`Diapositiva ${current.number}: falta CONTENIDO.`);

  const bodyBulleted = !body || bodyNormalized.valid;
  const contentBulleted = !content || contentNormalized.valid;
  if (body && !bodyBulleted) errors.push(`Diapositiva ${current.number}: CUERPO debe estar escrito por puntos.`);
  if (content && !contentBulleted) errors.push(`Diapositiva ${current.number}: CONTENIDO debe estar escrito por puntos.`);
  if (!reading) warnings.push(`Diapositiva ${current.number}: falta LECTURA. No podrás grabarla hasta agregarla.`);

  if (!visual) warnings.push(`Diapositiva ${current.number}: falta VISUAL. Usa al menos “TIPO: NINGUNO”.`);
  else if (!visualType) warnings.push(`Diapositiva ${current.number}: VISUAL no indica TIPO.`);
  else if (!VISUAL_TYPES.has(visualType)) warnings.push(`Diapositiva ${current.number}: TIPO de VISUAL no reconocido: ${visualType}.`);
  else if (!['IMAGEN', 'NINGUNO'].includes(visualType) && !visualHasSupportingData(visual)) {
    warnings.push(`Diapositiva ${current.number}: el VISUAL ${visualType} necesita datos para poder construirlo.`);
  }

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

  const rulesDetected = looksLikeRulesDocument(normalized);
  if (rulesDetected) {
    const embeddedScript = extractEmbeddedScriptFromRules(normalized);
    if (embeddedScript) {
      normalized = embeddedScript;
      corrections.push('Videos Studio detectó instrucciones mezcladas con el guion y extrajo automáticamente las diapositivas reales.');
    } else {
      return {
        slides: [],
        errors: [`Pegaste las reglas de ${CHANNEL_PROFILE.name}, no el guion generado. Copia estas reglas en ChatGPT y pega aquí únicamente su respuesta, comenzando por “DIAPOSITIVA 1”.`],
        warnings: ['Videos Studio ignoró los ejemplos y plantillas incluidos dentro de las reglas para evitar crear diapositivas falsas.'],
        corrections: [],
        inputKind: 'rules',
      };
    }
  } else if (looksLikePlaceholderTemplate(normalized)) {
    return {
      slides: [],
      errors: ['Pegaste una plantilla sin completar. Reemplaza los textos entre corchetes por el guion real antes de procesarla.'],
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
    warnings.unshift(`Videos Studio corrigió automáticamente ${uniqueCorrections.length} detalle${uniqueCorrections.length === 1 ? '' : 's'} al pegar el contenido.`);
  }

  return {
    slides,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    corrections: uniqueCorrections,
    inputKind: 'script',
  };
}
