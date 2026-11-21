/**
 * The two approvals.
 *
 * Only two actions interrupt the user:
 *
 *   1. archiving / terminating a session;
 *   2. deleting existing files or directories.
 *
 * Everything else — game launch, new sessions, builds, writes — runs without a
 * prompt.
 *
 * The delete check is a heuristic over the command string, not a sandbox. It
 * deliberately ignores delete words that appear inside a quoted string (a log
 * line, a message, a variable value) so that writing documentation about
 * deletion does not ask the user for approval.
 *
 * @module dsh-plan/gates
 */

import os from 'node:os'
import path from 'node:path'

/** Tool names that terminate or archive a session in this deployment. */
export const DEFAULT_ARCHIVE_TOOLS = [
  'cross_session_kill',
  'agent_teams_delete',
]

const DELETE_PATTERNS = [
  /\bremove-item\b/i,
  /\b(rm|del|erase|rmdir|rd)\b\s/i,
  /\brd\s+\/s\b/i,
  /\brmtree\b/i,
  /\bshutil\.rmtree\b/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\brobocopy\b[^\n]*\/mir\b/i,
  /\bformat\s+[a-z]:/i,
  /\bclear-content\b/i,
]

const PATH_PATTERN = /(?:[a-zA-Z]:\\[^\s"'|;]+|\/(?:[\w.\-]+\/)+[\w.\-]+|\.{1,2}[\\/][^\s"'|;]*)/g

function commandOf (exec) {
  const args = exec?.arguments
  if (args === null || typeof args !== 'object') return ''
  for (const key of ['command', 'script', 'cmd', 'commands']) {
    const value = args[key]
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string').join(' && ')
  }
  return ''
}

/** Quote state at one index: "double", "single", "backtick" or null. */
function quoteAt (text, index) {
  let quote = null
  for (let i = 0; i < index; i += 1) {
    const char = text[i]
    if (quote !== null) {
      if (char === quote && text[i - 1] !== '\\') quote = null
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char
    }
  }
  return quote
}

/** First match of a delete pattern that is not inside a quoted string. */
function hasUnquotedDeleteMatch (command) {
  return DELETE_PATTERNS.some((pattern) => {
    const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)
    let match
    while ((match = global.exec(command)) !== null) {
      if (quoteAt(command, match.index) === null) return true
      if (global.lastIndex <= match.index) break
    }
    return false
  })
}

function underScratch (file, cwd) {
  try {
    const resolved = path.resolve(file).toLowerCase()
    const temp = os.tmpdir().toLowerCase()
    const plan = path.join(cwd ?? process.cwd(), '.dsh-plan').toLowerCase()
    return resolved.startsWith(temp) || resolved.startsWith(plan)
  } catch {
    return false
  }
}

function isDeletingExistingFiles (command, cwd) {
  if (typeof command !== 'string' || command.trim().length === 0) return false
  if (!hasUnquotedDeleteMatch(command)) return false
  const paths = command.match(PATH_PATTERN) ?? []
  if (paths.length === 0) return true
  // A delete aimed only at the OS temp directory or the plugin's own state is
  // scratch cleanup, not destruction of the user's files.
  return paths.some((file) => !underScratch(file, cwd))
}

function ask (reason, zh, en) {
  return {
    kind: 'ask',
    reason,
    displayReason: { en, zh },
  }
}

/**
 * Decide one pre-execute call.
 *
 * @param {any} exec tool execution.
 * @param {{ archiveGate?: boolean, deleteGate?: boolean, archiveTools?: string[] }} config
 * @returns {undefined | { kind: 'ask', reason: string, displayReason: { en: string, zh: string } }}
 */
export function gateDecision (exec, config = {}) {
  const name = String(exec?.name ?? '')
  if (config.archiveGate !== false && (config.archiveTools ?? DEFAULT_ARCHIVE_TOOLS).includes(name)) {
    return ask(
      `dsh-plan: "${name}" archives or terminates a session; this needs explicit user approval.`,
      `dsh-plan：归档/终止会话需要你批准（${name}）。`,
      `dsh-plan: archiving a session needs your approval (${name}).`,
    )
  }
  if (config.deleteGate !== false && /^(pwsh|bash|shell|powershell)$/i.test(name)) {
    const command = commandOf(exec)
    const cwd = exec?.agent?.session?.header?.cwd
    if (isDeletingExistingFiles(command, cwd)) {
      return ask(
        'dsh-plan: this command deletes existing files or directories; this needs explicit user approval.',
        'dsh-plan：删除既有文件/目录需要你批准。',
        'dsh-plan: deleting existing files needs your approval.',
      )
    }
  }
  return undefined
}
