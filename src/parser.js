function trimBlankLines(lines) {
  const copy = [...lines];
  while (copy.length && !copy[0].trim()) copy.shift();
  while (copy.length && !copy[copy.length - 1].trim()) copy.pop();
  return copy.join('\n');
}

function finalizeSlide(current, slides, errors) {
  if (!current) return;

  const title = trimBlankLines(current.title);
  const body = trimBlankLines(current.body);
  const content = trimBlankLines(current.content);

  if (!Number.isFinite(current.number)) {
    errors.push('Se encontró una diapositiva sin número válido.');
    return;
  }

  if (!title) errors.push(`Diapositiva ${current.number}: falta TÍTULO.`);
  if (!body) errors.push(`Diapositiva ${current.number}: falta CUERPO.`);
  if (!content) errors.push(`Diapositiva ${current.number}: falta CONTENIDO.`);

  slides.push({
    number: current.number,
    title,
    body,
    content,
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
  let outsideText = [];

  const pushCurrent = () => {
    finalizeSlide(current, slides, errors);
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

    if (section) current[section].push(line);
    else if (trimmed) warnings.push(`Diapositiva ${current.number}: texto fuera de TÍTULO/CUERPO/CONTENIDO: “${trimmed}”.`);
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
