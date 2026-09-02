export const SLOT_COUNT = 6;
export const STAM_STEP_MS = 3 * 60 * 1000;
export const STAM_WARNING_MS = 2 * 60 * 60 * 1000;
export const IDLE_CAP_MS = 12 * 60 * 60 * 1000;
export const IDLE_LEAD_MS = 5 * 60 * 1000;
export const IDLE_WARNING_MINUTES = 2 * 60;
const STAM_BASE = 240;
const STAM_PER_RANK = 5;
const displayClockCache = new WeakMap();

const finite = (value, fallback) => { const number = Number(value); return Number.isFinite(number) ? number : fallback; };
const integer = (value, fallback) => { const number = parseInt(String(value ?? '').trim(), 10); return Number.isFinite(number) ? number : fallback; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const maxForRank = rank => Math.min(999, STAM_BASE + (clamp(Math.floor(finite(rank, 1)), 1, 200) - 1) * STAM_PER_RANK);
export const rankForMax = max => clamp(1 + Math.round((Math.max(STAM_BASE, finite(max, STAM_BASE)) - STAM_BASE) / STAM_PER_RANK), 1, 200);
export const formatClock = timestamp => {
  const date = new Date(timestamp);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
};
export const formatMinute = milliseconds => {
  const minutes = Math.max(1, Math.ceil(Math.max(0, finite(milliseconds, 0)) / 60000));
  return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0');
};

const SLOT_DEFAULTS = Object.freeze({ label:'', rank:1, stamCurrent:0, stamMax:STAM_BASE, stamStart:null, stamRunning:false, idleStart:null, idleCapMs:IDLE_CAP_MS, idleRunning:false, enabled:true });
function runtimeSlot(slot) {
  Object.defineProperties(slot, {
    dirty: { value:false, writable:true, enumerable:false },
    stamFullAt: { value:null, writable:true, enumerable:false },
    idleFullAt: { value:null, writable:true, enumerable:false }
  });
  refreshTimeline(slot);
  return slot;
}
const markDirty = slot => { slot.dirty = true; return slot; };
const shouldStore = slot => !Object.prototype.hasOwnProperty.call(slot, 'dirty') || slot.dirty;
export const isDirty = slot => !!slot.dirty;
function refreshTimeline(slot) {
  slot.stamFullAt = slot.stamRunning && slot.stamStart ? slot.stamStart + Math.max(0, slot.stamMax - slot.stamCurrent) * STAM_STEP_MS : null;
  slot.idleFullAt = slot.idleRunning && slot.idleStart ? slot.idleStart + slot.idleCapMs : null;
}
const stamFullAtFor = slot => Object.prototype.hasOwnProperty.call(slot, 'stamFullAt') ? slot.stamFullAt : (slot.stamRunning && slot.stamStart ? slot.stamStart + Math.max(0, slot.stamMax - slot.stamCurrent) * STAM_STEP_MS : null);
const idleFullAtFor = slot => Object.prototype.hasOwnProperty.call(slot, 'idleFullAt') ? slot.idleFullAt : (slot.idleRunning && slot.idleStart ? slot.idleStart + slot.idleCapMs : null);
export const emptySlot = () => runtimeSlot({ ...SLOT_DEFAULTS });
export const createSlots = () => Array.from({ length:SLOT_COUNT }, emptySlot);

export function normalizeSlot(source) {
  const input = source && typeof source === 'object' ? source : SLOT_DEFAULTS;
  const rank = input.rank != null ? clamp(integer(input.rank, SLOT_DEFAULTS.rank), 1, 200) : rankForMax(input.stamMax);
  const stamMax = maxForRank(rank);
  return runtimeSlot({
    label: typeof input.label === 'string' ? input.label : SLOT_DEFAULTS.label,
    rank,
    stamCurrent: clamp(finite(input.stamCurrent, SLOT_DEFAULTS.stamCurrent), 0, stamMax),
    stamMax,
    stamStart: finite(input.stamStart, null), stamRunning: !!input.stamRunning,
    idleStart: finite(input.idleStart, null), idleCapMs: finite(input.idleCapMs, IDLE_CAP_MS), idleRunning: !!input.idleRunning,
    enabled: input.enabled !== false
  });
}
export function computeStam(slot, now) {
  const current = clamp(finite(slot.stamCurrent, 0), 0, slot.stamMax);
  if (!slot.stamRunning || !slot.stamStart) return { current, fullAt:null, isFull:current >= slot.stamMax };
  const elapsed = Math.max(0, now - slot.stamStart);
  const recovered = Math.floor(elapsed / STAM_STEP_MS);
  const next = Math.min(slot.stamMax, current + recovered);
  if (next >= slot.stamMax) return { current:slot.stamMax, fullAt:slot.stamStart + Math.max(0, slot.stamMax - current) * STAM_STEP_MS, isFull:true };
  const nextIn = STAM_STEP_MS - (elapsed % STAM_STEP_MS);
  return { current:next, fullAt:now + (slot.stamMax - next - 1) * STAM_STEP_MS + nextIn, isFull:false };
}
export function computeIdle(slot, now) {
  if (!slot.idleRunning || !slot.idleStart) return { value:'未開始', plan:'—:—', isFull:false, remaining:null };
  const cap = finite(slot.idleCapMs, IDLE_CAP_MS);
  const remaining = Math.max(0, cap - Math.max(0, now - slot.idleStart));
  const fullAt = slot.idleStart + cap;
  return { value:remaining ? formatMinute(remaining) : 'MAX', plan:formatClock(fullAt), isFull:remaining === 0, remaining };
}

export function hasTimedProgress(slot, now) {
  const stamActive = slot.stamRunning && slot.stamStart && slot.stamCurrent < slot.stamMax && now < stamFullAtFor(slot);
  const idleActive = slot.idleRunning && slot.idleStart && now < idleFullAtFor(slot);
  return !!(stamActive || idleActive);
}

function cachedClock(slot, key, timestamp) {
  let cache = displayClockCache.get(slot);
  if (!cache) { cache = {}; displayClockCache.set(slot, cache); }
  if (cache[key] !== timestamp) { cache[key] = timestamp; cache[key + 'Text'] = formatClock(timestamp); }
  return cache[key + 'Text'];
}

// 正規化済みの実行時slot専用。分単位の描画では数値変換・再正規化を行わない。
export function displaySnapshot(slot, now, view) {
  const output = view || { stam:{}, idle:{} };
  const stam = output.stam || (output.stam = {});
  const idle = output.idle || (output.idle = {});
  let stamCurrent = slot.stamCurrent;
  let stamFullAt = null;
  if (slot.stamRunning && slot.stamStart) {
    const elapsed = Math.max(0, now - slot.stamStart);
    stamCurrent = Math.min(slot.stamMax, stamCurrent + Math.floor(elapsed / STAM_STEP_MS));
    stamFullAt = stamFullAtFor(slot);
  }
  const idleRunning = slot.idleRunning && slot.idleStart;
  const idleRemaining = idleRunning ? Math.max(0, slot.idleCapMs - Math.max(0, now - slot.idleStart)) : null;
  const idleMinutes = idleRemaining == null ? 0 : Math.max(1, Math.ceil(idleRemaining / 60000));
  stam.current = stamCurrent;
  stam.plan = stamFullAt ? cachedClock(slot, 'stam', stamFullAt) : '—:—';
  stam.low = stamFullAt != null && stamFullAt > now && stamFullAt - now < STAM_WARNING_MS;
  idle.value = idleRemaining == null ? '未開始' : (idleRemaining ? Math.floor(idleMinutes / 60) + ':' + String(idleMinutes % 60).padStart(2, '0') : 'MAX');
  idle.plan = idleRunning ? cachedClock(slot, 'idle', idleFullAtFor(slot)) : '—:—';
  idle.full = idleRemaining === 0;
  idle.low = idleRemaining != null && idleRemaining > 0 && idleMinutes < IDLE_WARNING_MINUTES;
  return output;
}
export const liveStam = (slot, now) => slot.stamRunning ? computeStam(slot, now).current : slot.stamCurrent;
export const remainingAfter40 = current => Math.max(0, Math.floor(finite(current, 0))) % 40;
export function setLabel(slot, value) {
  const label = String(value || '').trim();
  if (slot.label === label) return false;
  slot.label = label;
  markDirty(slot);
  return true;
}
export function setRank(slot, value, now) {
  const rank = clamp(Math.floor(finite(value, slot.rank)), 1, 200);
  if (slot.rank === rank) return false;
  if (slot.stamRunning && slot.stamStart) applyStam(slot, liveStam(slot, now), now);
  slot.rank = rank;
  slot.stamMax = maxForRank(rank);
  slot.stamCurrent = Math.min(slot.stamCurrent, slot.stamMax);
  refreshTimeline(slot);
  markDirty(slot);
  return true;
}
export const isSlotEnabled = slot => !!slot && slot.enabled !== false;
export function setSlotEnabled(slot, enabled) { const next = !!enabled; if (isSlotEnabled(slot) === next) return false; slot.enabled = next; markDirty(slot); return true; }
export function applyStam(slot, current, now) {
  const live = liveStam(slot, now);
  slot.stamCurrent = clamp(integer(current, live), 0, slot.stamMax);
  slot.stamStart = slot.stamRunning && slot.stamStart && !computeStam(slot, now).isFull
    ? now - (Math.max(0, now - slot.stamStart) % STAM_STEP_MS)
    : now;
  slot.stamRunning = true;
  refreshTimeline(slot);
  markDirty(slot);
}
export function restartIdle(slot, now) { slot.idleStart = now - IDLE_LEAD_MS; slot.idleRunning = true; refreshTimeline(slot); markDirty(slot); }
