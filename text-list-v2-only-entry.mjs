import { loadExistingV2Store } from './lunaby-core.mjs';

// TWA通常起動のクリティカルパスから「初回起動用ゲート」を外す。
// 既存データがある利用では gate モジュールを一切評価しない。
let gateModulePromise = null;
const gate = () => gateModulePromise || (gateModulePromise = import('./text-list-v2-only-gate.mjs'));
const renderGate = onInitialize => gate().then(({ renderV2OnlyGate }) => renderV2OnlyGate(onInitialize));
const renderError = () => gate().then(({ renderStartupError }) => renderStartupError());

// 永続化要求は起動描画のクリティカルパスから外す。
// TWA復帰直後のメインスレッド競合を避け、UIが落ち着いてから要求する。
const requestPersistence = () => {
  if (!(navigator.storage && navigator.storage.persist)) return;
  navigator.storage.persist().catch(() => {});
};
if (typeof requestIdleCallback === 'function') requestIdleCallback(requestPersistence, { timeout: 1500 });
else setTimeout(requestPersistence, 0);

const initializeAndStart = () => import('./lunaby-v2-first-launch.mjs')
  .then(({ initializeV2Store }) => initializeV2Store(localStorage))
  .then(initial => { if (initial) start(initial); else renderGate(initializeAndStart); })
  .catch(error => { console.error('[lunaby] initializeAndStart failed', error); renderGate(initializeAndStart); });
const start = loaded => import('./text-list.js')
  .then(module => module.startLunaby(loaded))
  .catch(error => {
    console.error('[lunaby] startLunaby failed', error);
    // 保存データは既にあるので「初回起動」の案内は誤り。専用のエラー表示にする。
    renderError();
  });
const existing = loadExistingV2Store(localStorage);
if (existing) start(existing);
else renderGate(initializeAndStart);
