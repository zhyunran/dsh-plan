#!/usr/bin/env node
/**
 * Fail loudly if this repository still carries machine-local or sensitive
 * strings. This script is the *check*; DESENSITIZE.md is the checklist. A
 * README must never claim the result of this check — the exit code is the
 * claim.
 *
 * Run: npm run check:desensitize
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.git', '.dsh-plan'])
const SKIP_FILES = new Set(['DESENSITIZE.md', 'check-desensitize.mjs'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt'])

// No personal account name is hardcoded here: this script is published too.
// Set DSH_DESENSITIZE_ACCOUNT when you want to scan for a specific local name.
const PATTERNS = [
  { name: 'windows user path', re: /C:\\Users\\[^\\\s]+/i },
  { name: 'posix home path', re: /\/(?:home|Users)\/(?!user(?:\/|$)|username|shared|public|example)[^/\s]+/i },
  { name: 'desktop path', re: /\\Desktop\\|\/Desktop\//i },
  { name: 'bearer token', re: /Authorization:\s*Bearer\s+\S{10,}/i },
  { name: 'api key assignment', re: /(?:api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{16,}['"]/i },
]
if (typeof process.env.DSH_DESENSITIZE_ACCOUNT === 'string' && process.env.DSH_DESENSITIZE_ACCOUNT.trim().length > 0) {
  PATTERNS.push({ name: 'local account', re: new RegExp(process.env.DSH_DESENSITIZE_ACCOUNT.trim(), 'i') })
}

async function* walk (dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      yield* walk(path.join(dir, entry.name))
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name)
    }
  }
}

const hits = []
for await (const file of walk(ROOT)) {
  if (SKIP_FILES.has(path.basename(file))) continue
  if (!TEXT_EXT.has(path.extname(file))) continue
  const text = await readFile(file, 'utf8').catch(() => '')
  const lines = text.split('\n')
  for (const { name, re } of PATTERNS) {
    lines.forEach((line, index) => {
      if (re.test(line)) hits.push({ file: path.relative(ROOT, file), line: index + 1, name })
    })
  }
}

if (hits.length === 0) {
  console.log('[OK] no local paths, accounts, or bearer tokens found')
  process.exit(0)
}

console.error(`[FAIL] ${hits.length} sensitive-looking line(s):`)
for (const hit of hits) console.error(`  ${hit.file}:${hit.line} (${hit.name})`)
process.exit(1)
