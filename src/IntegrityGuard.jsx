import { useEffect, useRef } from 'react';
import {
  getActiveProject,
  getProjectTakes,
  getTemplateMetadataMap,
  getTemplatePreferences,
  saveProject,
} from './storage';
import { getVisualCountsBySlide } from './visualStore';

const INHERIT = '__inherit__';
const NONE = '__none__';

function resolveChoice(value, fallback = '') {
  if (value === NONE) return '';
  if (!value || value === INHERIT) return fallback || '';
  return value;
}

function isActiveCta(cta = '') {
  const normalized = String(cta).toUpperCase();
  return !!normalized && !/TIPO\s*:\s*NINGUNO/.test(normalized) && normalized.trim() !== 'NINGUNO';
}

function pruneObject(source, validNumbers) {
  return Object.fromEntries(
    Object.entries(source || {}).filter(([key]) => validNumbers.has(Number(key))),
  );
}

function sameObject(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function templateSignature(metadata = {}) {
  if (!metadata) return '';
  return [
    metadata.sourceSize || 0,
    metadata.sourceModifiedAt || 0,
    metadata.dividerX || 0,
    metadata.dividerY || 0,
    metadata.analyzedAt || 0,
  ].join('|');
}

function effectiveTemplate(preferences, slideNumber) {
  return preferences?.perSlide?.[slideNumber] || preferences?.defaultPath || '';
}

export default function IntegrityGuard() {
  const runningRef = useRef(false);
  const timerRef = useRef(0);
  const templateSnapshotRef = useRef({ projectId: '', preferences: null, signatures: {} });

  async function auditIntegrity() {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const active = await getActiveProject();
      if (!active?.id || !Array.isArray(active.slides)) {
        templateSnapshotRef.current = { projectId: '', preferences: null, signatures: {} };
        return;
      }

      const validNumbers = new Set(active.slides.map((slide) => Number(slide.number)));
      const originalPlan = active.productionPlan || {};
      let scenes = pruneObject(originalPlan.scenes, validNumbers);
      const transitions = pruneObject(originalPlan.transitions, validNumbers);
      const ctaAssets = pruneObject(originalPlan.ctaAssets, validNumbers);
      const memes = (originalPlan.memes || []).filter((item) => validNumbers.has(Number(item.slideNumber)));
      let changed = !sameObject(scenes, originalPlan.scenes)
        || !sameObject(transitions, originalPlan.transitions)
        || !sameObject(ctaAssets, originalPlan.ctaAssets)
        || memes.length !== (originalPlan.memes || []).length;

      const readySlides = active.slides.filter((slide) => scenes?.[slide.number]?.ready);
      const [preferences, metadataMap] = await Promise.all([
        getTemplatePreferences(active.id),
        getTemplateMetadataMap(),
      ]);

      const previousSnapshot = templateSnapshotRef.current.projectId === active.id
        ? templateSnapshotRef.current
        : { projectId: active.id, preferences: null, signatures: {} };
      const nextSignatures = {};

      for (const slide of active.slides) {
        const path = effectiveTemplate(preferences, slide.number);
        nextSignatures[slide.number] = path ? `${path}::${templateSignature(metadataMap[path])}` : '';
      }

      let takes = [];
      let visualCounts = {};
      let libraryDefaults = {};
      if (readySlides.length) {
        [takes, visualCounts, libraryDefaults] = await Promise.all([
          getProjectTakes(active.id),
          getVisualCountsBySlide(active.id),
          window.videosStudio?.library?.getDefaults?.() || Promise.resolve({}),
        ]);
      }
      const takeMap = Object.fromEntries((takes || []).map((take) => [Number(take.slideNumber), take]));

      for (const slide of readySlides) {
        const number = Number(slide.number);
        const scene = scenes[number];
        const take = takeMap[number];
        const sceneUpdatedAt = Number(scene?.updatedAt) || 0;
        const visualCount = Number(visualCounts[number] || 0);
        const currentTransition = resolveChoice(
          originalPlan.transitions?.[number],
          resolveChoice(originalPlan.transitionDefault, libraryDefaults?.transitions || ''),
        );
        const currentCta = isActiveCta(slide.cta)
          ? resolveChoice(originalPlan.ctaAssets?.[number], libraryDefaults?.cta || '')
          : '';

        const previousTemplatePath = previousSnapshot.preferences
          ? effectiveTemplate(previousSnapshot.preferences, number)
          : effectiveTemplate(preferences, number);
        const currentTemplatePath = effectiveTemplate(preferences, number);
        const templateAssignmentChanged = previousSnapshot.preferences
          && previousTemplatePath !== currentTemplatePath;
        const templateMetadataChanged = previousSnapshot.preferences
          && previousSnapshot.signatures?.[number] !== nextSignatures[number];
        const templateChangedAfterReview = currentTemplatePath
          && Number(metadataMap[currentTemplatePath]?.analyzedAt || 0) > sceneUpdatedAt;

        const stale = !take?.cleanedBlob
          || (Number(take?.updatedAt) || 0) > sceneUpdatedAt
          || visualCount < 1
          || (Number(scene?.visualImages) > 0 && Number(scene.visualImages) !== visualCount)
          || String(scene?.transition || '') !== String(currentTransition || '')
          || String(scene?.ctaAsset || '') !== String(currentCta || '')
          || templateAssignmentChanged
          || templateMetadataChanged
          || templateChangedAfterReview;

        if (stale) {
          scenes = {
            ...scenes,
            [number]: {
              ...scene,
              ready: false,
              invalidatedAt: Date.now(),
              invalidatedBy: 'integrity-guard',
            },
          };
          changed = true;
        }
      }

      templateSnapshotRef.current = {
        projectId: active.id,
        preferences,
        signatures: nextSignatures,
      };

      if (!changed) return;
      await saveProject({
        ...active,
        productionPlan: {
          ...originalPlan,
          scenes,
          transitions,
          ctaAssets,
          memes,
        },
        updatedAt: Date.now(),
      });
      window.dispatchEvent(new CustomEvent('videosstudio:project-plan-changed'));
    } catch (caught) {
      console.error('IntegrityGuard:', caught);
    } finally {
      runningRef.current = false;
    }
  }

  function scheduleAudit(delay = 350) {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => auditIntegrity(), delay);
  }

  useEffect(() => {
    auditIntegrity();
    const interval = window.setInterval(() => auditIntegrity(), 30000);
    const onProjectChange = () => scheduleAudit(250);
    const onVisualChange = () => scheduleAudit(250);
    const onFocus = () => scheduleAudit(150);
    const onClick = (event) => {
      const button = event.target?.closest?.('button');
      const text = button?.textContent || '';
      if (/Guardar corte limpio|Aceptar|Regrabar|Repetir|Recuperar toma|Marcar escena lista|Predeterminar/i.test(text)) {
        scheduleAudit(/Guardar corte limpio|Recuperar toma/i.test(text) ? 1800 : 700);
      } else if (event.target?.closest?.('.template-drawer')) {
        scheduleAudit(700);
      }
    };
    const onChange = (event) => {
      if (event.target?.closest?.('.join-top-settings, .join-inspector, .template-drawer')) scheduleAudit(500);
    };

    window.addEventListener('videosstudio:project-plan-changed', onProjectChange);
    window.addEventListener('videosstudio:visuals-changed', onVisualChange);
    window.addEventListener('focus', onFocus);
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timerRef.current);
      window.removeEventListener('videosstudio:project-plan-changed', onProjectChange);
      window.removeEventListener('videosstudio:visuals-changed', onVisualChange);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('change', onChange, true);
    };
  }, []);

  return null;
}
