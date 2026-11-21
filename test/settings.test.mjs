import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeSettings, DEFAULT_MIN_ITEMS, DEFAULT_MAX_ITEMS } from '../lib/settings.js'

test('defaults are on, 7 to 12', () => {
  assert.deepEqual(normalizeSettings(undefined), {
    enabled: true,
    minItems: DEFAULT_MIN_ITEMS,
    maxItems: DEFAULT_MAX_ITEMS,
  })
})

test('an explicit range is kept', () => {
  assert.deepEqual(normalizeSettings({ minItems: 3, maxItems: 5 }), {
    enabled: true,
    minItems: 3,
    maxItems: 5,
  })
})

test('values are clamped into 1..50', () => {
  const low = normalizeSettings({ minItems: 0, maxItems: -4 })
  assert.equal(low.minItems, 1)
  assert.equal(low.maxItems, 1, 'a negative max is lifted to the min')

  const high = normalizeSettings({ minItems: 99, maxItems: 120 })
  assert.equal(high.minItems, 50)
  assert.equal(high.maxItems, 50)
})

test('min above max raises max to min instead of failing', () => {
  const settings = normalizeSettings({ minItems: 9, maxItems: 4 })
  assert.equal(settings.minItems, 9)
  assert.equal(settings.maxItems, 9)
})

test('the switch can be turned off independently', () => {
  assert.equal(normalizeSettings({ enabled: false }).enabled, false)
  assert.equal(normalizeSettings({ enabled: 'nonsense' }).enabled, true)
})

test('config defaults feed the fallback range', () => {
  assert.deepEqual(normalizeSettings({}, { minItems: 2, maxItems: 4 }), {
    enabled: true,
    minItems: 2,
    maxItems: 4,
  })
})

test('non-numeric values fall back instead of poisoning the limits', () => {
  const settings = normalizeSettings({ minItems: 'abc', maxItems: null })
  assert.equal(settings.minItems, DEFAULT_MIN_ITEMS)
  assert.equal(settings.maxItems, DEFAULT_MAX_ITEMS)
})
