export const AI_FORMAT_RULES = `REGLAS DE FORMATO PARA VIDEOS STUDIO

OBJETIVO
Genera un video por diapositivas usando EXACTAMENTE la estructura indicada. No cambies los nombres de los campos.

FORMATO OBLIGATORIO

DIAPOSITIVA 1
GANCHO:
Frase breve y potente que capte la atención al comenzar esta parte del video.

TÍTULO:
Título de la diapositiva

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

REGLAS
1. Cada bloque comienza con DIAPOSITIVA seguido de su número consecutivo: 1, 2, 3, 4...
2. Usa los campos GANCHO, TÍTULO, CUERPO, CONTENIDO, LECTURA, VISUAL y CTA.
3. CUERPO y CONTENIDO son lo que verá el espectador y deben estar SIEMPRE por puntos con guion.
4. No escribas párrafos largos en CUERPO ni CONTENIDO.
5. LECTURA es únicamente lo que leerá el presentador en el prompter. No se muestra en la diapositiva final.
6. VISUAL indica qué apoyo debe utilizar el montaje. TIPO puede ser IMAGEN, GRAFICO_BARRAS, TABLA, COMPARATIVA, CRONOLOGIA, DIAGRAMA o NINGUNO.
7. Si VISUAL es un gráfico o tabla, incluye dentro de VISUAL los datos necesarios en líneas claras.
8. CTA indica si esa diapositiva necesita un llamado a la acción. TIPO puede ser NINGUNO, SUSCRIBIRSE, COMENTAR, PREGUNTA, LIKE u OTRO.
9. La primera diapositiva debe incluir un GANCHO fuerte.
10. Aproximadamente a la mitad del total de diapositivas debe existir un CTA para suscribirse, comentar, responder una pregunta, dar like o participar.
11. La última diapositiva debe incluir un CTA de SUSCRIBIRSE.
12. El CTA debe ser coherente también con la LECTURA de esa diapositiva.
13. Mantén coherencia entre TÍTULO, CUERPO, CONTENIDO, LECTURA y VISUAL.
14. No pongas instrucciones de cámara, gestos o edición dentro de LECTURA.
15. Separa cada diapositiva con una línea que contenga únicamente //.
16. No omitas VISUAL ni CTA. Si no hacen falta, usa TIPO: NINGUNO.
17. Devuelve solamente las diapositivas en este formato, sin explicaciones antes ni después.`;

const VISUAL_TYPES = new Set(['IMAGEN', 'GRAFICO_BARRAS', 'GRÁFICO_BARRAS', 'TABLA', 'COMPARATIVA', 'CRONOLOGIA', 'CRONOLOGÍA', 'DIAGRAMA', 'NINGUNO']);
const CTA_TYPES = new Set(['NINGUNO', 'SUSCRIBIRSE', 'COMENTAR', 'PREGUNTA', 'LIKE', 'OTRO']);

function trimBlankLines(lines = []) {
  const copy = [...lines];
  while (copy.length && !copy[0].trim()) copy.shift();
  while (copy.length && !copy[copy.length - 1].trim()) copy.pop();
  return copy.join('\n');
}

function isBulletedBlock(value = '') {
  const lines = String(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^[-•*]\s+\S/.test(line));
}

function blockType(value = '') {
  return String(value).match(/^\s*TIPO\s*:\s*([^\n]+)$/im)?.[1]?.trim().toUpperCase() || '';
}

function ctaIsActive(cta = '') {
  const type = blockType(cta);
  if (type) return type !== 'NINGUNO';
  const normalized = String(cta).toUpperCase();
  return !!normalized && !/TIPO\s*:\s*NINGUNO/.test(normalized) && !/^NINGUNO\s*$/.test(normalized.trim());
}

function finalizeSlide(current, slides, errors, warnings) {
  if (!current) return;

  const hook = trimBlankLines(current.hook);
  const title = trimBlankLines(current.title);
  const body = trimBlankLines(current.body);
  const content = trimBlankLines(current.content);
  const reading = trimBlankLines(current.reading);
  const visual = trimBlankLines(current.visual);
  const cta = trimBlankLines(current.cta);
  const visualType = blockType(visual);
  const ctaType = blockType(cta);

  if (!Number.isFinite(current.number)) {
    errors.push('Se encontró una diapositiva sin número válido.');
    return;
  }

  if (!title) errors.push(`Diapositiva ${current.number}: falta TÍTULO.`);
  if (!body) errors.push(`Diapositiva ${current.number}: falta CUERPO.`);
  if (!content) errors.push(`Diapositiva ${current.number}: falta CONTENIDO.`);

  const bodyBulleted = !body || isBulletedBlock(body);
  const contentBulleted = !content || isBulletedBlock(content);
  if (body && !bodyBulleted) errors.push(`Diapositiva ${current.number}: CUERPO debe estar escrito por puntos.`);
  if (content && !contentBulleted) errors.push(`Diapositiva ${current.number}: CONTENIDO debe estar escrito por puntos.`);
  if (!reading) warnings.push(`Diapositiva ${current.number}: falta LECTURA. No podrás grabarla hasta agregarla.`);

  if (!visual) warnings.push(`Diapositiva ${current.number}: falta VISUAL. Usa al menos “TIPO: NINGUNO”.`);
  else if (!visualType) warnings.push(`Diapositiva ${current.number}: VISUAL no indica TIPO.`);
  else if (!VISUAL_TYPES.has(visualType)) warnings.push(`Diapositiva ${current.number}: TIPO de VISUAL no reconocido: ${visualType}.`);

  if (!cta) warnings.push(`Diapositiva ${current.number}: falta CTA. Usa al menos “TIPO: NINGUNO”.`);
  else if (!ctaType) warnings.push(`Diapositiva ${current.number}: CTA no indica TIPO.`);
  else if (!CTA_TYPES.has(ctaType)) warnings.push(`Diapositiva ${current.number}: TIPO de CTA no reconocido: ${ctaType}.`);

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
    warnings.push('La primera diapositiva no tiene GANCHO. La plantilla recomienda comenzar el video con uno.');
  }

  if (slides.length >= 3) {
    const middleIndex = Math.floor((slides.length - 1) / 2);
    const candidates = slides.slice(Math.max(0, middleIndex - 1), Math.min(slides.length, middleIndex + 2));
    if (!candidates.some((slide) => ctaIsActive(slide.cta))) {
      warnings.push('Falta un CTA intermedio aproximadamente a la mitad del video.');
    }
  }

  const last = slides[slides.length - 1];
  if (!/SUSCRIB/i.test(last.cta || '')) {
    warnings.push(`Diapositiva ${last.number}: el CTA final debería incluir SUSCRIBIRSE.`);
  }
}

export function parseSlides(rawText = '') {
  const normalized = String(rawText).replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const slides = [];
  const errors = [];
  const warnings = [];

  let current = null;
  let section = null;
  const outsideText = [];

  const pushCurrent = () => {
    finalizeSlide(current, slides, errors, warnings);
    current = null;
    section = null;
  };

  for (const originalLine of lines) {
    const line = originalLine.replace(/\uFEFF/g, '');
    const trimmed = line.trim();
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

    if (trimmed === '//') {
      if (current) pushCurrent();
      continue;
    }

    if (!current) {
      if (trimmed) outsideText.push(line);
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
      const match = line.match(matcher);
      if (!match) continue;
      section = key;
      if (match[1]) current[key].push(match[1]);
      matched = true;
      break;
    }
    if (matched) continue;

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
  return { slides, errors, warnings };
}
