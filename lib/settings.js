/**
 * Per-session settings: the on/off switch and the plan size range.
 *
 * `minItems` / `maxItems` bound the number of *required* items at plan
 * creation. Defaults are 7 and 12; the user can change them in the plan
 * viewer. Values are clamped, not rejected, so a bad input can never make the
 * plugin unusable.
 *
 * @module dsh-plan/settings
 */

export const DEFAULT_MIN_ITEMS = 7
export const DEFAULT_MAX_ITEMS = 12
export const HARD_MIN_ITEMS = 1
export const HARD_MAX_ITEMS = 50

function clampInt (value, fallback, min, max) {
  const number = typeof value === 'string' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

/**
 * Normalize one settings document.
 *
 * @param {any} raw persisted or posted settings.
 * @param {{ minItems?: number, maxItems?: number }} defaults config defaults.
 * @returns {{ enabled: boolean, minItems: number, maxItems: number }}
 */
export function normalizeSettings (raw, defaults = {}) {
  const fallbackMin = clampInt(defaults.minItems, DEFAULT_MIN_ITEMS, HARD_MIN_ITEMS, HARD_MAX_ITEMS)
  const fallbackMax = clampInt(defaults.maxItems, DEFAULT_MAX_ITEMS, HARD_MIN_ITEMS, HARD_MAX_ITEMS)
  const minItems = clampInt(raw?.minItems, fallbackMin, HARD_MIN_ITEMS, HARD_MAX_ITEMS)
  let maxItems = clampInt(raw?.maxItems, fallbackMax, HARD_MIN_ITEMS, HARD_MAX_ITEMS)
  if (minItems > maxItems) maxItems = minItems
  return {
    enabled: raw?.enabled !== false,
    minItems,
    maxItems,
  }
}
