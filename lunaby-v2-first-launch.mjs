import { SLOT_COUNT, normalizeSlot } from './abyss-runtime-core.mjs?rev=lunaby-v2-r27';
import { createSLState } from './starleap-state.mjs?rev=lunaby-v2-r27';
import { V2_STORAGE_KEY, V2_VERSION, loadExistingV2Store } from './lunaby-v2-store.mjs?rev=lunaby-v2-r27';

const packInitialSlot = slot => [slot.label, slot.rank, slot.stamCurrent, slot.stamStart || 0, slot.idleStart || 0, 0];

export function initializeV2Store(storage) {
  const existing = loadExistingV2Store(storage);
  if (existing) return existing;
  let stored = null;
  try { stored = storage.getItem(V2_STORAGE_KEY); } catch (_) { return null; }
  if (stored !== null && stored !== '') return null;
  const slots = Array.from({ length:SLOT_COUNT }, () => normalizeSlot());
  const sl = createSLState();
  const envelope = { v:V2_VERSION, s:slots.map(packInitialSlot), l:[sl.stamina.current, sl.stamina.start || 0, sl.orb.current, sl.orb.start || 0, 0] };
  try { storage.setItem(V2_STORAGE_KEY, JSON.stringify(envelope)); } catch (_) {}
  return { envelope, slots, sl, source:'initial', migrated:false };
}

export default initializeV2Store;

/** Initial-launch-only module. Do not import from normal runtime paths. */
