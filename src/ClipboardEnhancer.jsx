import { useEffect, useState } from 'react';
import { AI_FORMAT_RULES } from './parser';

function legacyCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand?.('copy') === true;
  textarea.remove();
  return copied;
}

async function tryNativeCopy(text) {
  const nativeWriter = window.videosStudio?.clipboard?.writeText;
  if (typeof nativeWriter !== 'function') return false;
  try {
    const result = await nativeWriter(text);
    if (!result?.ok) return false;
    if (result.verified === true && Number(result.length) !== AI_FORMAT_RULES.length) return false;
    return true;
  } catch (caught) {
    console.warn('Native clipboard fallback:', caught);
    return false;
  }
}

async function tryWebCopy(text) {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (caught) {
    console.warn('Web clipboard fallback:', caught);
    return false;
  }
}

async function copyRulesReliably() {
  if (await tryNativeCopy(AI_FORMAT_RULES)) return 'native';
  if (await tryWebCopy(AI_FORMAT_RULES)) return 'web';
  if (legacyCopy(AI_FORMAT_RULES)) return 'legacy';
  throw new Error('El portapapeles no está disponible.');
}

export default function ClipboardEnhancer() {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let resetTimer = 0;
    let noticeTimer = 0;

    const handler = async (event) => {
      const button = event.target?.closest?.('button');
      if (!button || button.textContent.trim() !== 'Copiar reglas IA') return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const originalLabel = 'Copiar reglas IA';
      button.disabled = true;
      button.textContent = 'Copiando…';

      try {
        await copyRulesReliably();
        button.textContent = '✓ Reglas copiadas';
        setNotice({
          type: 'success',
          text: 'Reglas de 11 Records copiadas. Pégalas en ChatGPT; en “Contenido fuente” pega solo el guion que ChatGPT genere.',
        });
      } catch (caught) {
        console.error(caught);
        button.textContent = 'No se pudo copiar';
        setNotice({
          type: 'error',
          text: 'No se pudieron copiar las reglas. Puedes usar “Descargar reglas” como respaldo.',
        });
      } finally {
        window.clearTimeout(resetTimer);
        window.clearTimeout(noticeTimer);
        resetTimer = window.setTimeout(() => {
          if (button?.isConnected) {
            button.disabled = false;
            button.textContent = originalLabel;
          }
        }, 1700);
        noticeTimer = window.setTimeout(() => setNotice(null), 4200);
      }
    };

    document.addEventListener('click', handler, true);
    return () => {
      document.removeEventListener('click', handler, true);
      window.clearTimeout(resetTimer);
      window.clearTimeout(noticeTimer);
    };
  }, []);

  if (!notice) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 430,
        padding: '11px 14px',
        border: `1px solid ${notice.type === 'success' ? '#b7e5ca' : '#f1bdc4'}`,
        borderRadius: 12,
        background: notice.type === 'success' ? '#f0fbf4' : '#fff3f4',
        color: notice.type === 'success' ? '#176b3a' : '#9f2938',
        boxShadow: '0 12px 30px rgba(16, 32, 51, .14)',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {notice.text}
    </div>
  );
}
