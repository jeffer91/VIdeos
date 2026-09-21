import { useEffect, useMemo, useState } from 'react';
import { AI_MASTER_PROMPT } from './parser';
import { CINEMA_MASTER_PROMPT } from './cinemaPrompt';

const FOOTBALL_VERIFICATION_ADDENDUM = `

VERIFICACIÓN OBLIGATORIA ANTES DE ENTREGAR EL GUION
Esta regla complementa todas las anteriores y tiene prioridad sobre la rapidez o espectacularidad del video.
- Cuando tengas acceso a búsqueda web, verifica activamente cada dato crítico antes de redactar: récord principal, récord anterior, fechas, edades, partidos, goles, asistencias, rankings, minutos, cronologías, transferencias y comparaciones.
- Prioriza fuentes oficiales: competición, federación, club, organismo o base estadística reconocida. Para una afirmación histórica o comparativa importante, intenta contrastarla con una segunda fuente confiable independiente.
- Comprueba la cronología completa. Si dos fechas o cantidades producen una contradicción temporal, no redactes la afirmación hasta resolverla.
- No uses tu memoria como única fuente para una cifra precisa.
- Si dos fuentes confiables discrepan, omite el dato o redacta únicamente lo que ambas permiten afirmar con seguridad.
- Antes de responder, haz una última revisión factual diapositiva por diapositiva y elimina cualquier dato que no hayas podido sostener.
- Mantén EXACTAMENTE el formato de salida solicitado por Videos Studio. No agregues bibliografía, notas ni texto fuera de las diapositivas; la verificación debe realizarse antes de escribir la respuesta final.`;

const CINEMA_VERIFICATION_ADDENDUM = `

VERIFICACIÓN OBLIGATORIA ANTES DE ENTREGAR EL GUION
- Verifica título, año, reparto, dirección y cualquier dato externo concreto que menciones.
- No inventes premios, taquilla, declaraciones, recepción crítica, fechas ni datos de producción.
- Distingue claramente los hechos de tu valoración de la película.
- No reveles giros importantes del argumento salvo que el usuario haya pedido expresamente un análisis con spoilers.
- Antes de responder, revisa que el veredicto inicial, las cinco áreas, sus puntuaciones, la nota sobre 10 y la recomendación final sean coherentes entre sí.
- Mantén EXACTAMENTE el formato de salida solicitado por Videos Studio. No agregues bibliografía, notas ni texto fuera de las diapositivas.`;

function downloadText(text, filename) {
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export default function PromptVerificationGuard({ contentMode = 'football' }) {
  const [notice, setNotice] = useState('');
  const isCinema = contentMode === 'cinema';
  const prompt = useMemo(
    () => isCinema
      ? `${CINEMA_MASTER_PROMPT}${CINEMA_VERIFICATION_ADDENDUM}`
      : `${AI_MASTER_PROMPT}${FOOTBALL_VERIFICATION_ADDENDUM}`,
    [isCinema],
  );

  useEffect(() => {
    const intercept = async (event) => {
      const button = event.target?.closest?.('.content-flow .heading-actions button');
      if (!button) return;
      const label = (button.textContent || '').trim();
      if (!/Copiar prompt IA|Descargar prompt/i.test(label)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      try {
        if (/Descargar/i.test(label)) {
          downloadText(prompt, isCinema ? 'prompt-maestro-cine-videos-studio-verificado.txt' : 'prompt-maestro-11-records-videos-studio-verificado.txt');
          setNotice(isCinema ? 'Prompt de cine reforzado descargado.' : 'Prompt reforzado descargado.');
          return;
        }
        const nativeWriter = window.videosStudio?.clipboard?.writeText;
        if (nativeWriter) await nativeWriter(prompt);
        else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt);
        else throw new Error('Portapapeles no disponible.');
        setNotice(isCinema ? 'Prompt de cine copiado con verificación factual.' : 'Prompt copiado con verificación factual reforzada.');
      } catch (caught) {
        setNotice(caught?.message || 'No se pudo preparar el prompt reforzado.');
      }
    };

    document.addEventListener('click', intercept, true);
    return () => document.removeEventListener('click', intercept, true);
  }, [prompt, isCinema]);

  if (!notice) return null;
  return (
    <div className="prompt-verification-toast" onClick={() => setNotice('')}>
      {notice}
    </div>
  );
}
