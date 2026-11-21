/**
 * Disk persistence for one session's plan.
 *
 * Layout (inside the session working directory):
 *
 *   .dsh-plan/<sessionId>/plan.json      the current plan, rewritten atomically
 *   .dsh-plan/<sessionId>/questions.md   items waiting on the user, rendered
 *   .dsh-plan/<sessionId>/stalled.md     written when enforcement gave up
 *   .dsh-plan/<sessionId>/log.jsonl      append-only change log
 *
 * The disk copy is the recovery copy: after restart, resume, fork or
 * compaction, the plan is read back by session id and the checkbox state is
 * intact.
 *
 * @module dsh-plan/store
 */

import { mkdir, readFile, rename, writeFile, appendFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'

/** Directory holding this session's plan files. */
export function planDir (cwd, sessionId) {
  return path.join(cwd, '.dsh-plan', sanitize(sessionId))
}

function sanitize (value) {
  return String(value ?? 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** Read the persisted plan, or undefined when the session has none. */
export async function loadPlan (cwd, sessionId) {
  try {
    const text = await readFile(path.join(planDir(cwd, sessionId), 'plan.json'), 'utf8')
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** Rewrite plan.json through a temp file so a crash never leaves half JSON. */
export async function savePlan (cwd, plan) {
  const dir = planDir(cwd, plan.sessionId)
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, 'plan.json')
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
  await rename(temp, target)
}

/**
 * Move the current plan into `plans/<timestamp>.json` and remove plan.json, so
 * the next round starts from an empty slot. The archive keeps the full item
 * list and evidence for the "view plan" panel.
 */
export async function archivePlan (cwd, sessionId, plan, reason) {
  const dir = planDir(cwd, sessionId)
  const archiveDir = path.join(dir, 'plans')
  await mkdir(archiveDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(archiveDir, `${stamp}.json`)
  const archive = { ...plan, archivedAt: Date.now(), archiveReason: String(reason ?? 'completed') }
  await writeFile(target, `${JSON.stringify(archive, null, 2)}\n`, 'utf8')
  try { await unlink(path.join(dir, 'plan.json')) } catch { /* already gone */ }
  return target
}

/** Recent archived plans for one session, newest first. */
export async function listArchives (cwd, sessionId, limit = 20) {
  try {
    const dir = path.join(planDir(cwd, sessionId), 'plans')
    const files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort().reverse().slice(0, limit)
    const out = []
    for (const file of files) {
      try {
        const plan = JSON.parse(await readFile(path.join(dir, file), 'utf8'))
        out.push({
          archivedAt: plan.archivedAt ?? null,
          reason: plan.archiveReason ?? 'completed',
          items: Array.isArray(plan.items) ? plan.items : [],
        })
      } catch {
        /* a half-written archive is skipped, not fatal */
      }
    }
    return out
  } catch {
    return []
  }
}

/** Read this session's switch. A missing file means the default (on). */
export async function loadSettings (cwd, sessionId) {
  try {
    const text = await readFile(path.join(planDir(cwd, sessionId), 'settings.json'), 'utf8')
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') return undefined
    return { enabled: parsed.enabled !== false }
  } catch {
    return undefined
  }
}

/** Persist this session's settings (switch + plan size range). */
export async function saveSettings (cwd, sessionId, settings) {
  const dir = planDir(cwd, sessionId)
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, 'settings.json')
  const payload = {
    enabled: settings.enabled !== false,
    ...(Number.isFinite(settings.minItems) ? { minItems: settings.minItems } : {}),
    ...(Number.isFinite(settings.maxItems) ? { maxItems: settings.maxItems } : {}),
  }
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

/** Append one change record to log.jsonl. */
export async function appendLog (cwd, sessionId, entry) {
  const dir = planDir(cwd, sessionId)
  await mkdir(dir, { recursive: true })
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry })
  await appendFile(path.join(dir, 'log.jsonl'), `${line}\n`, 'utf8')
}

/** Render the current items that need the user into questions.md. */
export async function writeQuestions (cwd, plan) {
  const dir = planDir(cwd, plan.sessionId)
  await mkdir(dir, { recursive: true })
  const items = plan.items.filter((item) => item.status === 'needs_user')
  const lines = [
    '# 待你回答 / Waiting on you',
    '',
    `- session: \`${plan.sessionId}\``,
    `- 项目目录: \`${plan.cwd}\``,
    `- 最近更新: ${new Date(plan.updatedAt).toISOString()}`,
    '',
  ]
  if (items.length === 0) {
    lines.push('（当前没有需要你回答的事项）', '')
  } else {
    items.forEach((item, index) => {
      lines.push(`## Q${index + 1} · ${item.id} ${item.text}`, '', item.question ?? '(missing question)', '')
      if (item.done_when) lines.push(`验收标准：${item.done_when}`, '')
    })
  }
  const target = path.join(dir, 'questions.md')
  await writeFile(target, `${lines.join('\n')}\n`, 'utf8')
  return target
}

/** Render the stall report written when enforcement gives up. */
export async function writeStalled (cwd, plan, reason) {
  const dir = planDir(cwd, plan.sessionId)
  await mkdir(dir, { recursive: true })
  const pending = plan.items.filter((item) => item.status === 'todo')
  const lines = [
    '# 任务单卡住报告 / Plan stalled',
    '',
    `原因：${reason}`,
    `时间：${new Date().toISOString()}`,
    '',
    '## 仍未完成',
    '',
    ...pending.map((item) => `- ${item.id} ${item.text} — 验收：${item.done_when}`),
    '',
    '插件已停止强制续行。请决定：继续、改单、或标为 needs_user。',
    '',
  ]
  const target = path.join(dir, 'stalled.md')
  await writeFile(target, `${lines.join('\n')}\n`, 'utf8')
  return target
}

/** Append one action record (game launch, new peer session) to actions.jsonl. */
export async function appendAction (cwd, sessionId, entry) {
  const dir = planDir(cwd, sessionId)
  await mkdir(dir, { recursive: true })
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry })
  await appendFile(path.join(dir, 'actions.jsonl'), `${line}\n`, 'utf8')
}
