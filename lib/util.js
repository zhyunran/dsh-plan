/**
 * Dependency-free helpers shared by the plugin modules.
 *
 * This file imports nothing from DSH so it can be unit-tested with a plain
 * Node interpreter; the message constructor mirrors `createUserMessage` from
 * `@deepseek-ai/dsh-llm` (fresh stable id, frozen snapshot) without taking a
 * dependency on that package.
 *
 * @module dsh-plan/util
 */

import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/** Recursively freeze a JSON-like value without cloning it. */
export function deepFreeze (value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

/**
 * Build the user-role message DSH's agent inbox expects.
 *
 * @param {{ content: Array<Record<string, unknown>>, source: Record<string, unknown> }} input
 * @returns {Readonly<Record<string, unknown>>}
 */
export function createUserMessage ({ content, source }) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content,
    source,
  })
}

/** Render one epoch millisecond value as a stable UTC timestamp. */
export function isoTime (ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 19)}Z`
}

/** Normalize single-or-array argument into an array. */
export function asArray (value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** Collapse whitespace and lowercase, for phrase matching only. */
export function normalizeText (value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** True when a value is a plain non-array object. */
export function isRecord (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a UTF-8 text file, returning undefined instead of throwing. */
export async function readText (file) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

/** Lowercase hex SHA-256 of one file's bytes. */
export async function sha256File (file) {
  const buffer = await readFile(file)
  return createHash('sha256').update(buffer).digest('hex')
}
