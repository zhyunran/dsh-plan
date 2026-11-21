/**
 * Rendering helpers: status card, steer message, tool payloads.
 *
 * The status text is computed from the checkbox state, never from model prose.
 *
 * @module dsh-plan/render
 */

import { stats, STATUS } from './model.js'

const ICON = { todo: '[ ]', done: '[x]', needs_user: '[?]' }

/** One-line summary used by tools and the status line. */
export function summaryLine (plan) {
  const counts = stats(plan)
  const state = plan.paused ? '已暂停' : plan.stalled ? '卡住' : '进行中'
  return `任务单 ${counts.requiredDone}/${counts.required} 必需项完成 · ${counts.needsUser} 项待你 · ${state}`
}

/** Full status text for `plan_status`. */
export function statusText (plan) {
  const counts = stats(plan)
  const lines = [
    summaryLine(plan),
    `模式：${plan.mode === 'run' ? 'run（直到你说停）' : 'task（本轮）'} · 会话：${plan.sessionId}`,
    '',
  ]
  for (const item of plan.items) {
    const icon = ICON[item.status] ?? '[ ]'
    const kind = item.type === 'optional' ? '（可选）' : ''
    lines.push(`${icon} ${item.id} ${item.text}${kind}`)
    lines.push(`    验收：${item.done_when}`)
    if (item.status === STATUS.DONE && item.evidence) lines.push(`    证据：${item.evidence}`)
    if (item.status === STATUS.NEEDS_USER && item.question) lines.push(`    待你：${item.question}`)
  }
  if (counts.needsUser > 0) lines.push('', `问题清单已写入 .dsh-plan/${plan.sessionId}/questions.md`)
  return lines.join('\n')
}

/** The message steered back into the session when a required item is still todo. */
export function nextPrompt (plan) {
  const item = plan.items.find((entry) => entry.type === 'required' && entry.status === STATUS.TODO)
  const counts = stats(plan)
  if (item === undefined) return ''
  const remaining = counts.required - counts.requiredDone
  return [
    `【任务单】还剩 ${remaining} 个必需项。下一项：${item.id} ${item.text}`,
    `验收标准：${item.done_when}`,
    '做完就 plan_check；做不动就 plan_needs_user 并写清问题。',
    '需要我决定的事未满 3 件时，先做别的，不要停下来问。',
  ].join('\n')
}

/** Tool-facing JSON view. Must contain only lossless-JSON values (no undefined). */
export function planView (plan) {
  return {
    sessionId: plan.sessionId,
    mode: plan.mode,
    paused: plan.paused === true,
    ...(plan.pausedReason ? { pausedReason: plan.pausedReason } : {}),
    stalled: plan.stalled === true,
    stats: stats(plan),
    items: plan.items.map((item) => ({
      id: item.id,
      text: item.text,
      done_when: item.done_when,
      type: item.type,
      check: item.check,
      status: item.status,
      ...(item.evidence ? { evidence: item.evidence } : {}),
      ...(item.question ? { question: item.question } : {}),
    })),
    removals: plan.removals ?? [],
  }
}

/** Text renderer used by tool outputs. */
export function renderTool (value) {
  if (value && typeof value.text === 'string') return [{ type: 'text', text: value.text }]
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/**
 * Payload for the Web UI's plan dock.
 *
 * `enforced` answers the question the user actually asks: "is this session
 * currently being held by the plugin?" It is true only when a plan exists, is
 * not paused or stalled, and a required item is still todo — i.e. exactly the
 * state in which a turn cannot end.
 *
 * @param {any} plan
 */
export function statePayload (plan, enabled = true, hostVersion) {
  const version = typeof hostVersion === 'string' && hostVersion.length > 0 ? hostVersion : 'unknown'
  if (plan === undefined || plan === null) {
    return { active: false, enabled: enabled !== false, enforced: false, canEnd: true, hostVersion: version }
  }
  const counts = stats(plan)
  const hasTodo = plan.items.some((item) => item.type === 'required' && item.status === STATUS.TODO)
  const next = plan.items.find((item) => item.type === 'required' && item.status === STATUS.TODO)
  return {
    active: true,
    enabled: enabled !== false,
    hostVersion: version,
    enforced: enabled !== false && plan.paused !== true && plan.stalled !== true && hasTodo,
    canEnd: !hasTodo,
    mode: plan.mode,
    paused: plan.paused === true,
    pausedReason: plan.pausedReason || '',
    stalled: plan.stalled === true,
    updatedAt: plan.updatedAt,
    stats: counts,
    next: next ? { id: next.id, text: next.text, done_when: next.done_when } : null,
    items: plan.items.map((item) => ({
      id: item.id,
      text: item.text,
      done_when: item.done_when,
      type: item.type,
      check: item.check,
      status: item.status,
      ...(item.evidence ? { evidence: item.evidence } : {}),
      ...(item.question ? { question: item.question } : {}),
    })),
  }
}
