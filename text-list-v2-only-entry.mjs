import { loadExistingV2Store } from './lunaby-core.mjs';
import { renderV2OnlyGate } from './text-list-v2-only-gate.mjs';

const existing = loadExistingV2Store(localStorage);
const start = loaded => import('./text-list.js').then(module => module.startLunaby(loaded)).catch(renderV2OnlyGate);
if (existing) {
  start(existing);
} else {
  renderV2OnlyGate(() => {
    // first-launch は保険専用。通常起動では読まない。
    import('./lunaby-v2-first-launch.mjs').then(({ initializeV2Store }) => {
      const initial = initializeV2Store(localStorage);
      if (initial) start(initial);
    }).catch(() => {});
  });
}
