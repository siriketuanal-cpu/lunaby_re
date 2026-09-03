/* lunaby-core.mjs
 * 通常起動用コアの統合モジュール。
 * 再分離するときは各 SECTION ブロックを元ファイルに戻す。
 *   SECTION abyss-runtime  → abyss-runtime-core.mjs
 *   SECTION starleap-state → starleap-state.mjs
 *   SECTION starleap-lite  → starleap-lite-core.mjs
 *   SECTION v2-store       → lunaby-v2-store.mjs
 * gate / first-launch は保険用のため本ファイルには含めない。
 */

// =============================================================================
// SECTION: abyss-runtime  (was abyss-runtime-core.mjs)
// =============================================================================
export const SLOT_COUNT = 6;
const STAM_STEP_MS = 3 * 60 * 1000;
const STAM_WARNING_MS = 2 * 60 * 60 * 1000;
const IDLE_CAP_MS = 12 * 60 * 60 * 1000;
const IDLE_LEAD_MS = 5 * 60 * 1000;
const IDLE_WARNING_MINUTES = 2 * 60;
const STAM_BASE = 240;
const STAM_PER_RANK = 5;
const displayClockCache = new WeakMap();

const finite = (value, fallback) => { const number = Number(value); return Number.isFinite(number) ? number : fallback; };
const integer = (value, fallback) => { const number = parseInt(String(value ?? '').trim(), 10); return Number.isFinite(number) ? number : fallback; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const maxForRank = rank => Math.min(999, STAM_BASE + (clamp(Math.floor(finite(rank, 1)), 1, 200) - 1) * STAM_PER_RANK);
const rankForMax = max => clamp(1 + Math.round((Math.max(STAM_BASE, finite(max, STAM_BASE)) - STAM_BASE) / STAM_PER_RANK), 1, 200);
export const formatClock = timestamp => {
  const date = new Date(timestamp);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
};
const formatMinute = milliseconds => {
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
function refreshTimeline(slot) {
  slot.stamFullAt = slot.stamRunning && slot.stamStart ? slot.stamStart + Math.max(0, slot.stamMax - slot.stamCurrent) * STAM_STEP_MS : null;
  slot.idleFullAt = slot.idleRunning && slot.idleStart ? slot.idleStart + slot.idleCapMs : null;
}
const stamFullAtFor = slot => Object.prototype.hasOwnProperty.call(slot, 'stamFullAt') ? slot.stamFullAt : (slot.stamRunning && slot.stamStart ? slot.stamStart + Math.max(0, slot.stamMax - slot.stamCurrent) * STAM_STEP_MS : null);
const idleFullAtFor = slot => Object.prototype.hasOwnProperty.call(slot, 'idleFullAt') ? slot.idleFullAt : (slot.idleRunning && slot.idleStart ? slot.idleStart + slot.idleCapMs : null);
const emptySlot = () => runtimeSlot({ ...SLOT_DEFAULTS });
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
function computeStam(slot, now) {
  const current = clamp(finite(slot.stamCurrent, 0), 0, slot.stamMax);
  if (!slot.stamRunning || !slot.stamStart) return { current, fullAt:null, isFull:current >= slot.stamMax };
  const elapsed = Math.max(0, now - slot.stamStart);
  const recovered = Math.floor(elapsed / STAM_STEP_MS);
  const next = Math.min(slot.stamMax, current + recovered);
  if (next >= slot.stamMax) return { current:slot.stamMax, fullAt:slot.stamStart + Math.max(0, slot.stamMax - current) * STAM_STEP_MS, isFull:true };
  const nextIn = STAM_STEP_MS - (elapsed % STAM_STEP_MS);
  return { current:next, fullAt:now + (slot.stamMax - next - 1) * STAM_STEP_MS + nextIn, isFull:false };
}
function computeIdle(slot, now) {
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

// =============================================================================
// SECTION: starleap-state  (was starleap-state.mjs)
// =============================================================================
export const SL_STAM_MAX = 80;
export const SL_STAM_STEP_MS = 12 * 60 * 1000;
export const SL_ORB_MAX = 4;
export const SL_ORB_STEP_MS = 6 * 60 * 60 * 1000;

function normalizeTimer(source, max) {
  const input = source && typeof source === 'object' ? source : {};
  const current = clamp(finite(input.current, 0), 0, max);
  const start = finite(input.start, null);
  return { current, start, running: !!input.running && !!start };
}

export function createSLState(source) {
  return { stamina: normalizeTimer(source && source.stamina, SL_STAM_MAX), orb: normalizeTimer(source && source.orb, SL_ORB_MAX) };
}

// =============================================================================
// SECTION: starleap-lite  (was starleap-lite-core.mjs)
// =============================================================================
const isTimerActive = (timer, max, interval, now) => !!(timer.running && timer.start && timer.current < max && now < timer.start + (max - timer.current) * interval);

export function getTimerInfo(timer, max, interval, now, output) {
  const result = output || {};
  const current = clamp(finite(timer.current, 0), 0, max);
  if (!timer.running || !timer.start) { result.current = current; result.running = false; result.isFull = current >= max; result.nextIn = null; result.fullIn = null; result.fullAt = null; return result; }
  const elapsed = Math.max(0, now - timer.start);
  const recovered = Math.floor(elapsed / interval);
  const nextCurrent = Math.min(max, current + recovered);
  const fullAt = timer.start + Math.max(0, max - current) * interval;
  if (nextCurrent >= max) { result.current = max; result.running = false; result.isFull = true; result.nextIn = 0; result.fullIn = 0; result.fullAt = fullAt; return result; }
  const nextIn = interval - (elapsed % interval);
  const fullIn = (max - nextCurrent - 1) * interval + nextIn;
  result.current = nextCurrent; result.running = true; result.isFull = false; result.nextIn = nextIn; result.fullIn = fullIn; result.fullAt = now + fullIn;
  return result;
}

export function formatSLDuration(milliseconds) { const totalMinutes = Math.max(1, Math.ceil(Math.max(0, finite(milliseconds, 0)) / 60000)); return Math.floor(totalMinutes / 60) + ':' + String(totalMinutes % 60).padStart(2, '0'); }

export function parseFullRecoveryInput(raw) {
  const value = String(raw || '').trim().replace(/：/g, ':');
  if (!value) return null;
  let hours = 0; let minutes = 0;
  if (value.includes(':')) { const parts = value.split(':'); if (parts.length !== 2 || parts.some(part => !/^\d+$/.test(part))) return null; hours = Number(parts[0]); minutes = Number(parts[1]); }
  else if (/^\d+$/.test(value)) { if (value.length <= 2) minutes = Number(value); else { hours = Number(value.slice(0, -2)); minutes = Number(value.slice(-2)); } }
  else return null;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes > 59) return null;
  const result = (hours * 60 + minutes) * 60000;
  return result <= SL_ORB_MAX * SL_ORB_STEP_MS ? result : null;
}

export function applyStamina(timer, value, now) { const current = clamp(integer(value, timer.current), 0, SL_STAM_MAX); timer.current = current; timer.running = current < SL_STAM_MAX; timer.start = timer.running ? now : null; return timer; }
export function applyFullRecovery(timer, milliseconds, now) { const fullIn = clamp(finite(milliseconds, 0), 0, SL_ORB_MAX * SL_ORB_STEP_MS); const missing = fullIn === 0 ? 0 : Math.ceil(fullIn / SL_ORB_STEP_MS); timer.current = SL_ORB_MAX - missing; if (!missing) { timer.running = false; timer.start = null; return timer; } const nextIn = fullIn - (missing - 1) * SL_ORB_STEP_MS; timer.running = true; timer.start = now - (SL_ORB_STEP_MS - nextIn); return timer; }
export function hasSLTimedProgress(state, now) { return isTimerActive(state.stamina, SL_STAM_MAX, SL_STAM_STEP_MS, now) || isTimerActive(state.orb, SL_ORB_MAX, SL_ORB_STEP_MS, now); }

// =============================================================================
// SECTION: v2-store  (was lunaby-v2-store.mjs)
// dirty 前提で同一内容比較は省略。unpack の厳密検査は維持。
// =============================================================================
export const V2_STORAGE_KEY = 'lunaby:state:v2';
export const V2_VERSION = 2;

const STAM_RUNNING = 1;
const IDLE_RUNNING = 2;
const SLOT_DISABLED = 16;
const SL_STAM_RUNNING = 1;
const SL_ORB_RUNNING = 2;
const SLOT_LABEL = 0;
const SLOT_RANK = 1;
const SLOT_STAM_CURRENT = 2;
const SLOT_STAM_START = 3;
const SLOT_IDLE_START = 4;
const SLOT_FLAGS = 5;
const SLOT_FIELDS = 6;
const SL_STAM_CURRENT = 0;
const SL_STAM_START = 1;
const SL_ORB_CURRENT = 2;
const SL_ORB_START = 3;
const SL_FLAGS = 4;
const SL_FIELDS = 5;

const timestamp = value => {
  const number = finite(value, 0);
  return number > 0 && number < 9_000_000_000_000_000 ? Math.floor(number) : null;
};
const flag = (value, bit) => (Number.isInteger(value) && (value & bit) !== 0);

function packSlot(slot) {
  const flags = (slot.stamRunning ? STAM_RUNNING : 0)
    | (slot.idleRunning ? IDLE_RUNNING : 0)
    | (slot.enabled === false ? SLOT_DISABLED : 0);
  const packed = new Array(SLOT_FIELDS);
  packed[SLOT_LABEL] = slot.label;
  packed[SLOT_RANK] = slot.rank;
  packed[SLOT_STAM_CURRENT] = slot.stamCurrent;
  packed[SLOT_STAM_START] = slot.stamStart || 0;
  packed[SLOT_IDLE_START] = slot.idleStart || 0;
  packed[SLOT_FLAGS] = flags;
  return packed;
}

function unpackSlot(input) {
  if (!Array.isArray(input) || input.length !== SLOT_FIELDS || typeof input[SLOT_LABEL] !== 'string' || !Number.isInteger(input[SLOT_FLAGS])) return null;
  const flags = input[SLOT_FLAGS];
  return normalizeSlot({
    label: input[SLOT_LABEL],
    rank: input[SLOT_RANK],
    stamCurrent: input[SLOT_STAM_CURRENT],
    stamStart: timestamp(input[SLOT_STAM_START]),
    stamRunning: flag(flags, STAM_RUNNING),
    idleStart: timestamp(input[SLOT_IDLE_START]),
    idleRunning: flag(flags, IDLE_RUNNING),
    enabled: !flag(flags, SLOT_DISABLED)
  });
}

function packSL(sl) {
  const flags = (sl.stamina.running ? SL_STAM_RUNNING : 0) | (sl.orb.running ? SL_ORB_RUNNING : 0);
  const packed = new Array(SL_FIELDS);
  packed[SL_STAM_CURRENT] = sl.stamina.current;
  packed[SL_STAM_START] = sl.stamina.start || 0;
  packed[SL_ORB_CURRENT] = sl.orb.current;
  packed[SL_ORB_START] = sl.orb.start || 0;
  packed[SL_FLAGS] = flags;
  return packed;
}

function unpackSL(input) {
  if (!Array.isArray(input) || input.length !== SL_FIELDS || !Number.isInteger(input[SL_FLAGS])) return null;
  const flags = input[SL_FLAGS];
  return createSLState({
    stamina: { current: input[SL_STAM_CURRENT], start: timestamp(input[SL_STAM_START]), running: flag(flags, SL_STAM_RUNNING) },
    orb: { current: input[SL_ORB_CURRENT], start: timestamp(input[SL_ORB_START]), running: flag(flags, SL_ORB_RUNNING) }
  });
}

function parseV2(storage) {
  let value = null;
  try { value = JSON.parse(storage.getItem(V2_STORAGE_KEY) || 'null'); } catch (_) { return null; }
  if (!value || value.v !== V2_VERSION || !Array.isArray(value.s) || value.s.length !== SLOT_COUNT) return null;
  const slots = value.s.map(unpackSlot);
  const sl = unpackSL(value.l);
  return slots.every(Boolean) && sl ? { envelope:value, slots, sl } : null;
}

function packState(slots, sl) {
  return { v:V2_VERSION, s:slots.map(packSlot), l:packSL(sl) };
}

function makeLoaded(envelope, slots, sl, source, migrated) {
  return { envelope, slots, sl, source, migrated };
}

export function loadExistingV2Store(storage) {
  const v2 = parseV2(storage);
  return v2 ? makeLoaded(v2.envelope, v2.slots, v2.sl, 'v2', false) : null;
}

export function saveV2Store(storage, envelope, slots, changedIndex, sl) {
  const target = envelope && envelope.v === V2_VERSION ? envelope : packState(slots, sl);
  let changed = false;
  const indexes = Number.isInteger(changedIndex) && changedIndex >= 0 && changedIndex < slots.length
    ? [changedIndex]
    : slots.map((_, index) => index);

  for (const index of indexes) {
    const slot = slots[index];
    if (!slot || !slot.dirty) continue;
    target.s[index] = packSlot(slot);
    slot.dirty = false;
    changed = true;
  }

  if (sl) {
    // SL は dirty フラグが無いため、5要素の簡易比較のみ（同一ならスキップ）
    const nextSL = packSL(sl);
    const prev = target.l;
    if (!prev || prev.length !== nextSL.length || nextSL.some((value, i) => value !== prev[i])) {
      target.l = nextSL;
      changed = true;
    }
  }

  if (!changed) return false;
  storage.setItem(V2_STORAGE_KEY, JSON.stringify(target));
  return true;
}
