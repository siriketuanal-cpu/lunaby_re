export const SL_STAM_MAX = 80;
export const SL_STAM_STEP_MS = 12 * 60 * 1000;
export const SL_ORB_MAX = 4;
export const SL_ORB_STEP_MS = 6 * 60 * 60 * 1000;

const finite = (value, fallback) => { const number = Number(value); return Number.isFinite(number) ? number : fallback; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function normalizeTimer(source, max) {
  const input = source && typeof source === 'object' ? source : {};
  const current = clamp(finite(input.current, 0), 0, max);
  const start = finite(input.start, null);
  return { current, start, running: !!input.running && !!start };
}

export function createSLState(source) {
  return { stamina: normalizeTimer(source && source.stamina, SL_STAM_MAX), orb: normalizeTimer(source && source.orb, SL_ORB_MAX) };
}
