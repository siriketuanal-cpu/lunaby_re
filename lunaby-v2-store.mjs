import { SLOT_COUNT, normalizeSlot } from './abyss-runtime-core.mjs?rev=lunaby-v2-r27';
import { createSLState } from './starleap-state.mjs?rev=lunaby-v2-r27';

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

const finite = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const timestamp = value => {
  const number = finite(value, 0);
  return number > 0 && number < 9_000_000_000_000_000 ? Math.floor(number) : null;
};
const flag = (value, bit) => (Number.isInteger(value) && (value & bit) !== 0);
const sameArray = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

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
  return {
    envelope,
    slots,
    sl,
    source,
    migrated
  };
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
    const next = packSlot(slot);
    if (!sameArray(target.s[index], next)) { target.s[index] = next; changed = true; }
    slot.dirty = false;
  }

  if (sl) {
    const nextSL = packSL(sl);
    if (!sameArray(target.l, nextSL)) { target.l = nextSL; changed = true; }
  }

  if (!changed) return false;
  storage.setItem(V2_STORAGE_KEY, JSON.stringify(target));
  return true;
}

export function v2ByteLength(storage) {
  return (storage.getItem(V2_STORAGE_KEY) || '').length;
}
