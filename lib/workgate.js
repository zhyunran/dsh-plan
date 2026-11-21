/**
 * The "no work without an open item" gate.
 *
 * Completion enforcement (a turn may not end while a required item is todo)
 * only bites when a plan exists. This gate covers the other half: the model
 * may not *start* state-changing work without an open checklist item, so a
 * task cannot be done "off the books".
 *
 * Reads, searches, questions and the plan tools themselves are not gated.
 * The plan is found for the agent, or for its parent when the caller is a
 * subagent — a child inherits the parent's checklist.
 *
 * @module dsh-plan/workgate
 */

/** Tools that change state. Everything not listed here is ungated. */
export const DEFAULT_WORK_TOOLS = [
  'write',
  'edit',
  'pwsh',
  'bash',
  'app_launch',
  'subagent',
  'subagent_fork',
  'workflow',
  'cross_session_create',
]

/**
 * @param {string} toolName the tool about to run.
 * @param {any} plan the agent's plan (or its parent's).
 * @param {{ requireOpenItemForWork?: boolean, workTools?: string[] }} config
 * @returns {undefined | { kind: 'deny', reason: string }}
 */
export function workGateDecision (toolName, plan, config = {}) {
  if (config.requireOpenItemForWork === false) return undefined
  const workTools = config.workTools ?? DEFAULT_WORK_TOOLS
  if (!workTools.includes(String(toolName ?? ''))) return undefined

  if (plan === undefined || plan === null) {
    return {
      kind: 'deny',
      reason: 'dsh-plan: 还没有任务单。先用 plan_create 建单（至少 7 个 required 项，每项写可观察的 done_when），再动状态；已经存在的单子可以 plan_update add 加项。',
    }
  }
  if (plan.paused === true) {
    return {
      kind: 'deny',
      reason: 'dsh-plan: 任务单已暂停（用户说停）。等用户恢复或明确让你继续，不要继续动状态。',
    }
  }
  const open = plan.items.some((item) => item.type === 'required' && item.status === 'todo')
  if (!open) {
    return {
      kind: 'deny',
      reason: 'dsh-plan: 任务单没有开放项（全部完成或都在等用户）。先 plan_create 建下一张单，或 plan_update add 把这件事加进现有单子，再动手。',
    }
  }
  return undefined
}
