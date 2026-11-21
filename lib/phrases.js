/**
 * Phrase classification for real user messages.
 *
 * The plugin never reads model output to decide whether the user stopped: it
 * reads `session/event` `user/message` events whose `source.kind === 'user'`.
 * A cross-session peer message, a subagent report or a goal round is not a
 * user stop and can never pause a plan.
 *
 * Matching is deliberately conservative in the "stop" direction: an ambiguous
 * message leaves the plan unchanged. The reliable emergency stop is the
 * runtime's own stop button, which this plugin cannot and does not intercept.
 *
 * @module dsh-plan/phrases
 */

import { normalizeText } from './util.js'

/** Built-in run instructions: the user wants work to continue unattended. */
export const DEFAULT_RUN_PHRASES = [
  '我没说停就不停',
  '不说停就不停',
  '没说停就不停',
  '直到我说停',
  '现在工作',
  '继续工作',
  '不用停',
  '别停手',
  '一直做',
]

/** Built-in stop instructions. */
export const DEFAULT_STOP_PHRASES = [
  '全部停',
  '现在停',
  '先停',
  '停一下',
  '停一停',
  '停下',
  '停止',
  '停手',
  '停游戏',
  '停吧',
  '急停',
  '暂停',
  '别干了',
  '不用继续',
  '不要继续',
]

/**
 * Negations that turn a stop word into a continue word. Checked before the
 * stop list so "不要停 / 别停 / 没说停" never pauses a plan.
 */
export const DEFAULT_NEGATIONS = [
  '不要停',
  '别停',
  '不许停',
  '不能停',
  '不说停',
  '没说停',
  '没让停',
  '不会停',
  '不要停止',
  '别停下',
]

/** Resume instructions, only honored while the plan is paused. */
export const DEFAULT_RESUME_PHRASES = ['继续', '接着', '开工', '恢复', '继续做', '接着做']

/**
 * Classify one user message.
 *
 * @param {string} text raw message text.
 * @param {{ paused?: boolean, runPhrases?: string[], stopPhrases?: string[] }} options
 * @returns {{ kind: 'stop' | 'resume' | 'run' | 'none', phrase?: string }}
 */
export function classifyUserText (text, options = {}) {
  const haystack = normalizeText(text)
  if (haystack.length === 0) return { kind: 'none' }

  const runPhrases = options.runPhrases ?? DEFAULT_RUN_PHRASES
  for (const phrase of runPhrases) {
    const needle = normalizeText(phrase)
    if (needle.length > 0 && haystack.includes(needle)) return { kind: 'run', phrase }
  }

  for (const phrase of DEFAULT_NEGATIONS) {
    if (haystack.includes(normalizeText(phrase))) return { kind: 'none', phrase }
  }

  // A message that is only "停" (plus punctuation) is the most common
  // emergency phrase and must not be missed, while "停" inside a longer word
  // (停机场, 停机时间) must not pause the plan.
  if (/^停[。.!！吧]?$/.test(haystack)) {
    return { kind: 'stop', phrase: '停' }
  }

  const stopPhrases = options.stopPhrases ?? DEFAULT_STOP_PHRASES
  for (const phrase of stopPhrases) {
    const needle = normalizeText(phrase)
    if (needle.length > 0 && haystack.includes(needle)) return { kind: 'stop', phrase }
  }

  if (options.paused === true) {
    for (const phrase of DEFAULT_RESUME_PHRASES) {
      if (haystack.includes(normalizeText(phrase))) return { kind: 'resume', phrase }
    }
  }

  return { kind: 'none' }
}

/**
 * Extract the text of one user message event's `data` payload.
 *
 * @param {any} data the `user/message` event data.
 * @returns {string}
 */
export function messageText (data) {
  const blocks = Array.isArray(data?.content) ? data.content : []
  const parts = []
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Words that mean "this acceptance failed", used only when needs_user items exist. */
export const DEFAULT_REJECT_PATTERNS = [
  '不行',
  '不对',
  '不像',
  '不通过',
  '不接受',
  '驳回',
  '重做',
  '差得远',
  '不是这个',
]

/**
 * Classify one user message as a rejection of a parked acceptance item.
 *
 * Only called when the plan actually has `needs_user` items; otherwise those
 * words are ordinary conversation. The item id (P3) is optional: when exactly
 * one item is parked, that item is the target.
 *
 * @param {string} text raw message text.
 * @param {{ hasNeedsUser?: boolean }} options
 * @returns {{ reject: boolean, itemId?: string, reason?: string }}
 */
export function classifyRejection (text, options = {}) {
  if (options.hasNeedsUser !== true) return { reject: false }
  const haystack = normalizeText(text)
  if (haystack.length === 0) return { reject: false }
  const hit = DEFAULT_REJECT_PATTERNS.find((word) => haystack.includes(normalizeText(word)))
  if (hit === undefined) return { reject: false }
  const idMatch = /p\d+/i.exec(haystack)
  return {
    reject: true,
    ...(idMatch ? { itemId: idMatch[0].toUpperCase() } : {}),
    reason: String(text ?? '').trim().slice(0, 400),
  }
}
