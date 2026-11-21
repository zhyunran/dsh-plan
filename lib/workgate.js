/**
 * The "no plan, no tools" gate.
 *
 * Completion enforcement (a turn may not end while a required item is todo)
 * only bites when a plan exists. This gate covers the other half: with the
 * session switch on, the model may not call tools before a plan exists, so a
 * task cannot be done "off the books".
 *
 * Two strengths:
 *
 *   - `requirePlanForAllTools: true` (default): every tool is refused when the
 *     session has no plan, the plan is paused, or no required item is open.
 *     Only the `plan_*` tools and `ask_user_question` stay open.
 *   - `requirePlanForAllTools: false`: the older, narrower mode — only the
 *     state-changing work tools are refused.
 *
 * The plan is found for the agent, or for its parent when the caller is a
 * subagent — a child inherits the parent's checklist.
 *
 * @module dsh-plan/workgate
 */

/** Tools that change state (the narrow mode; also listed in the docs). */
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

/** The escape hatch: creating or editing the plan must always be possible. */
function isAlwaysAllowed (toolName) {
  return toolName.startsWith('plan_') || toolName === 'ask_user_question'
}

/**
 * Why the current plan state forbids the call, or undefined when it is fine.
 *
 * @param {any} plan
 * @returns {undefined | { kind: 'deny', reason: string }}
 */
export function planStateDenial (plan) {
  if (plan === undefined || plan === null) {
    return {
      kind: 'deny',
      reason: 'dsh-plan: 这个会话还没有任务单。先用 plan_create 建单（至少 7 个 required 项，每项写可观察的 done_when），再调用工具；已经存在的单子可以 plan_update add 加项。',
    }
  }
  if (plan.paused === true) {
    return {
      kind: 'deny',
      reason: 'dsh-plan: 任务单已暂停（用户说停）。等用户恢复或明确让你继续，不要继续调用工具。',
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

/**
 * The all-tools gate (default mode).
 *
 * @param {string} toolName
 * @param {any} plan
 * @param {{ requireOpenItemForWork?: boolean }} config
 * @returns {undefined | { kind: 'deny', reason: string }}
 */
export function toolGateDecision (toolName, plan, config = {}) {
  if (config.requireOpenItemForWork === false) return undefined
  if (isAlwaysAllowed(String(toolName ?? ''))) return undefined
  return planStateDenial(plan)
}

/**
 * The narrow work-tools gate (legacy mode).
 *
 * @param {string} toolName the tool about to run.
 * @param {any} plan the agent's plan (or its parent's).
 * @param {{ requireOpenItemForWork?: boolean, workTools?: string[] }} config
 * @returns {undefined | { kind: 'deny', reason: string }}
 */
export function workGateDecision (toolName, plan, config = {}) {
  if (config.requireOpenItemForWork === false) return undefined
  const workTools = config.workTools ?? DEFAULT_WORK_TOOLS
  if (!workTools.includes(String(toolName ?? ''))) return undefined
  return planStateDenial(plan)
}
