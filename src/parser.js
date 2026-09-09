export const AI_FORMAT_RULES = `REGLAS DE FORMATO PARA VIDEOS STUDIO

OBJETIVO
Genera diapositivas usando EXACTAMENTE la estructura indicada. No cambies los nombres de los campos y no agregues campos nuevos.

FORMATO OBLIGATORIO

DIAPOSITIVA 1
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
Texto que debe leer el presentador durante la grabación. Puede estar redactado como uno o varios párrafos naturales. Debe corresponder a la misma diapositiva y ser coherente con el TÍTULO, CUERPO y CONTENIDO.

//

DIAPOSITIVA 2
TÍTULO:
...

CUERPO:
- ...

CONTENIDO:
- ...

LECTURA:
...

//

REGLAS
1. Cada bloque debe comenzar con DIAPOSITIVA seguido de su número consecutivo.
2. Usa exactamente estos cuatro campos: TÍTULO, CUERPO, CONTENIDO y LECTURA.
3. CUERPO es información que se mostrará visualmente en la diapositiva.
4. CONTENIDO es información que también se mostrará visualmente en la diapositiva.
5. CUERPO debe estar SIEMPRE escrito por puntos, usando un guion al inicio de cada punto: - texto.
6. CONTENIDO debe estar SIEMPRE escrito por puntos, usando un guion al inicio de cada punto: - texto.
7. No escribas párrafos largos dentro de CUERPO ni CONTENIDO.
8. LECTURA contiene únicamente lo que el presentador debe leer en el prompter.
9. LECTURA no se mostrará en la diapositiva final.
10. LECTURA puede ser un texto hablado natural; no es obligatorio escribirla por puntos.
11. No pongas instrucciones de cámara, edición, gestos o producción dentro de LECTURA.
12. Mantén coherencia entre lo que se ve (TÍTULO + CUERPO + CONTENIDO) y lo que se lee (LECTURA).
13. Separa cada diapositiva con una línea que contenga únicamente //.
14. No omitas ningún campo.
15. No transformes, renombres ni combines los campos.
16. Devuelve solamente las diapositivas en este formato, sin explicaciones antes ni después.`;

function trimBlankLines(lines) {
  const copy = [...lines];
  while (copy.length && !copy[0].trim()) copy.shift();
  while (copy.length && !copy[copy.length - 1].trim()) copy.pop();
  return copy.join('\n');
}

function isBulletedBlock(value) {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^[-•*]\s+\S/.test(line));
}

function finalizeSlide(current, slides, errors, warnings) {
  if (!current) return;

  const title = trimBlankLines(current.title);
  const body = trimBlankLines(current.body);
  const content = trimBlankLines(current.content);
  const reading = trimBlankLines(current.reading);

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
  if (!reading) warnings.push(`Diapositiva ${current.number}: falta LECTURA. Podrás conservar el proyecto, pero no grabar esta diapositiva hasta agregarla.`);

  slides.push({
    number: current.number,
    title,
    body,
    content,
    reading,
    validation: {
      title: !!title,
      body: !!body,
      content: !!content,
      reading: !!reading,
      bodyBulleted,
      contentBulleted,
    },
  });
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
        title: [],
        body: [],
        content: [],
        reading: [],
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

    const titleMatch = line.match(/^\s*T[IÍ]TULO\s*:\s*(.*)$/i);
    if (titleMatch) {
      section = 'title';
      if (titleMatch[1]) current.title.push(titleMatch[1]);
      continue;
    }

    const bodyMatch = line.match(/^\s*CUERPO\s*:\s*(.*)$/i);
    if (bodyMatch) {
      section = 'body';
      if (bodyMatch[1]) current.body.push(bodyMatch[1]);
      continue;
    }

    const contentMatch = line.match(/^\s*CONTENIDO\s*:\s*(.*)$/i);
    if (contentMatch) {
      section = 'content';
      if (contentMatch[1]) current.content.push(contentMatch[1]);
      continue;
    }

    const readingMatch = line.match(/^\s*LECTURA\s*:\s*(.*)$/i);
    if (readingMatch) {
      section = 'reading';
      if (readingMatch[1]) current.reading.push(readingMatch[1]);
      continue;
    }

    if (section) current[section].push(line);
    else if (trimmed) warnings.push(`Diapositiva ${current.number}: texto fuera de TÍTULO/CUERPO/CONTENIDO/LECTURA: “${trimmed}”.`);
  }

  if (current) pushCurrent();

  if (outsideText.length) {
    warnings.push('Se encontró texto fuera de las diapositivas y se ignoró.');
  }

  if (!slides.length) {
    errors.push('No se detectaron diapositivas. Usa bloques que empiecen con “DIAPOSITIVA 1”, “DIAPOSITIVA 2”, etc.');
  }

  const seen = new Set();
  for (const slide of slides) {
    if (seen.has(slide.number)) errors.push(`El número de diapositiva ${slide.number} está repetido.`);
    seen.add(slide.number);
  }

  return { slides, errors, warnings };
}
