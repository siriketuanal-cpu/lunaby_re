import { loadExistingV2Store } from './lunaby-core.mjs';
import { renderV2OnlyGate } from './text-list-v2-only-gate.mjs';

const initializeAndStart = () => import('./lunaby-v2-first-launch.mjs')
  .then(({ initializeV2Store }) => initializeV2Store(localStorage))
  .then(initial => { if (initial) start(initial); else renderV2OnlyGate(initializeAndStart); })
  .catch(() => renderV2OnlyGate(initializeAndStart));
const start = loaded => import('./text-list.js')
  .then(module => module.startLunaby(loaded))
  .catch(() => renderV2OnlyGate(initializeAndStart));
const existing = loadExistingV2Store(localStorage);
if (existing) start(existing);
else renderV2OnlyGate(initializeAndStart);
