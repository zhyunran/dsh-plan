/**
 * Evidence formats accepted by `plan_check`.
 *
 * Two shapes only, both checkable without a model:
 *
 *   sha256:<path>@<hex>   the file exists and its SHA-256 starts with <hex>
 *   log:<path>@<text>     the file contains <text> (case-sensitive substring)
 *
 * A witness for `check: "auto"` uses the same two shapes. Paths may be
 * relative to the session working directory.
 *
 * @module dsh-plan/evidence
 */

import path from 'node:path'
import { readText, sha256File } from './util.js'

function fail (message) {
  const error = new Error(message)
  error.name = 'PlanEvidenceError'
  throw error
}

function resolvePath (cwd, value) {
  const text = String(value ?? '').trim()
  if (text.length === 0) fail('evidence path is empty')
  return path.isAbsolute(text) ? text : path.resolve(cwd, text)
}

/**
 * Verify one evidence / witness string.
 *
 * @param {string} spec evidence spec.
 * @param {string} cwd session working directory.
 * @returns {Promise<{ ok: true, kind: string, detail: string }>}
 */
export async function verifyEvidence (spec, cwd) {
  const text = String(spec ?? '').trim()
  if (text.length === 0) fail('evidence is empty')

  if (text.startsWith('sha256:')) {
    const rest = text.slice('sha256:'.length)
    const split = rest.lastIndexOf('@')
    if (split <= 0) fail('sha256 evidence must look like sha256:<path>@<hex>')
    const file = resolvePath(cwd, rest.slice(0, split))
    const expected = rest.slice(split + 1).trim().toLowerCase()
    if (!/^[0-9a-f]{8,64}$/.test(expected)) fail('sha256 evidence needs a hex digest of at least 8 characters')
    let actual
    try {
      actual = await sha256File(file)
    } catch {
      fail(`evidence file does not exist or cannot be read: ${file}`)
    }
    if (!actual.startsWith(expected)) {
      fail(`evidence hash mismatch for ${file}: expected ${expected}…, actual ${actual.slice(0, 16)}…`)
    }
    return { ok: true, kind: 'sha256', detail: `${file} (${actual.slice(0, 16)}…)` }
  }

  if (text.startsWith('log:')) {
    const rest = text.slice('log:'.length)
    const split = rest.lastIndexOf('@')
    if (split <= 0) fail('log evidence must look like log:<path>@<text>')
    const file = resolvePath(cwd, rest.slice(0, split))
    const needle = rest.slice(split + 1)
    if (needle.length === 0) fail('log evidence needs the text to find after "@"')
    const body = await readText(file)
    if (body === undefined) fail(`evidence file does not exist or cannot be read: ${file}`)
    if (!body.includes(needle)) fail(`evidence text not found in ${file}: ${needle}`)
    return { ok: true, kind: 'log', detail: `${file} contains "${needle}"` }
  }

  if (text.startsWith('exists:')) {
    const file = resolvePath(cwd, text.slice('exists:'.length))
    const body = await readText(file)
    if (body === undefined) fail(`evidence path does not exist: ${file}`)
    return { ok: true, kind: 'exists', detail: file }
  }

  fail('unknown evidence format. Use sha256:<path>@<hex> or log:<path>@<text>')
}
