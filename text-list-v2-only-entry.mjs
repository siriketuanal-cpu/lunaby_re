import { loadExistingV2Store } from './lunaby-core.mjs';
import { renderV2OnlyGate, renderStartupError } from './text-list-v2-only-gate.mjs';

const initializeAndStart = () => import('./lunaby-v2-first-launch.mjs')
  .then(({ initializeV2Store }) => initializeV2Store(localStorage))
  .then(initial => { if (initial) start(initial); else renderV2OnlyGate(initializeAndStart); })
  .catch(error => { console.error('[lunaby] initializeAndStart failed', error); renderV2OnlyGate(initializeAndStart); });
const start = loaded => import('./text-list.js')
  .then(module => module.startLunaby(loaded))
  .catch(error => {
    console.error('[lunaby] startLunaby failed', error);
    // 保存データは既にあるので「初回起動」の案内は誤り。押しても同じ処理を
    // やり直して同じ場所で失敗するだけなので、専用のエラー表示にする。
    renderStartupError();
  });
const existing = loadExistingV2Store(localStorage);
if (existing) start(existing);
else renderV2OnlyGate(initializeAndStart);
