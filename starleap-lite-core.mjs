import { SL_STAM_MAX, SL_STAM_STEP_MS, SL_ORB_MAX, SL_ORB_STEP_MS } from './starleap-state.mjs?rev=lunaby-v2-r24';
export { createSLState, SL_STAM_MAX, SL_STAM_STEP_MS, SL_ORB_MAX, SL_ORB_STEP_MS } from './starleap-state.mjs?rev=lunaby-v2-r24';

const finite = (value, fallback) => { const number = Number(value); return Number.isFinite(number) ? number : fallback; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const integer = (value, fallback) => { const number = parseInt(String(value ?? '').trim(), 10); return Number.isFinite(number) ? number : fallback; };
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
