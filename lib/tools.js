/**
 * The six model-facing tools.
 *
 * Naming contract: `plan_*` is deliberately narrow and greppable so a user can
 * tell at a glance which calls touch the task list.
 *
 * @module dsh-plan/tools
 */

import { CHECKS, STATUS, TYPES, addItems, checkItem, createPlan, editItem, needsUser, removeItem, resetItem } from './model.js'
import { verifyEvidence } from './evidence.js'
import { planView, renderTool, statusText, summaryLine } from './render.js'

function textResult (text) {
  return { text }
}

/**
 * Build the tool set for one plugin instance.
 *
 * @param {{ defineTool: Function, manager: any }} input
 */
export function createTools ({ defineTool, manager }) {
  const create = defineTool({
    name: 'plan_create',
    description:
      'Create the task plan for this session BEFORE starting work. ' +
      'A plan needs at least 7 required items; each item must have an observable done_when. ' +
      'Item line format: "text || done_when || required|optional || evidence|auto || witness". ' +
      'check="evidence" means plan_check must cite sha256:<path>@<hex> or log:<path>@<text>; ' +
      'check="auto" means the item carries a witness in the same two formats and is checked by the plugin. ' +
      'A turn cannot end while any required item is still todo, so mark real blockers with plan_needs_user.',
    parameters: {
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'Item lines, one per string. Minimum 7 required items.',
      },
      mode: {
        type: 'string',
        description: '"task" (this turn) or "run" (keep going until the user says stop). Default task.',
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderTool(value) },
    async execute (args, exec) {
      const plan = await manager.create(exec.agent, { lines: args.items ?? [], mode: args.mode })
      return textResult(`${summaryLine(plan)}\n\n${statusText(plan)}`)
    },
  })

  const status = defineTool({
    name: 'plan_status',
    description: 'Read the current task plan: every item, its done_when, status, evidence and pending questions. Use it to rebuild your own memory after compaction.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderTool(value) },
    async execute (_args, exec) {
      const plan = await manager.require(exec.agent)
      return { ...planView(plan), text: statusText(plan) }
    },
  })

  const check = defineTool({
    name: 'plan_check',
    description:
      'Check one item off ONLY after it is actually done. Required items with check="evidence" must cite evidence: ' +
      'sha256:<path>@<hex> (file hash) or log:<path>@<text> (substring found in a file). ' +
      'check="auto" items are verified against the witness recorded at plan time. ' +
      'Checking early is the one thing the user can see instantly — do not do it.',
    parameters: {
      id: { type: 'string', description: 'Plan item id, e.g. P3.' },
      evidence: { type: 'string', description: 'Evidence spec (sha256:<path>@<hex> or log:<path>@<text>) when the item needs it.' },
      note: { type: 'string', description: 'Optional one-line note for the user.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderTool(value) },
    async execute (args, exec) {
      const { plan, cwd } = await manager.requireWithCwd(exec.agent)
      const item = plan.items.find((entry) => entry.id === args.id)
      if (item === undefined) throw new Error(`no plan item "${args.id}" (current ids: ${plan.items.map((entry) => entry.id).join(', ')})`)
      if (item.status === STATUS.NEEDS_USER) throw new Error(`${item.id} is waiting on the user; reset it with plan_update action="reset" before checking it.`)
      if (item.status === STATUS.DONE) throw new Error(`${item.id} is already done.`)

      let evidence = args.evidence
      if (item.check === CHECKS.AUTO) {
        await verifyEvidence(item.witness, cwd)
        evidence = item.witness
      } else if (item.type === TYPES.REQUIRED) {
        await verifyEvidence(args.evidence, cwd)
        evidence = args.evidence
      }

      const checked = checkItem(plan, item.id, evidence)
      if (typeof args.note === 'string' && args.note.trim().length > 0) checked.note = args.note.trim()
      await manager.persist(plan, { action: 'check', id: item.id, evidence })
      return textResult(`已勾选 ${item.id}：${item.text}\n${summaryLine(plan)}`)
    },
  })

  const needs = defineTool({
    name: 'plan_needs_user',
    description:
      'Park one item on the user: it stops blocking the turn, and its question is collected into .dsh-plan/<session>/questions.md. ' +
      'Use this when you genuinely cannot proceed without a decision, not to avoid work. ' +
      'If fewer than 3 things need the user, keep doing other items first.',
    parameters: {
      id: { type: 'string', description: 'Plan item id, e.g. P4.' },
      question: { type: 'string', description: 'The exact question the user must answer.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderTool(value) },
    async execute (args, exec) {
      const { plan } = await manager.requireWithCwd(exec.agent)
      const item = needsUser(plan, args.id, args.question)
      await manager.persist(plan, { action: 'needs_user', id: item.id })
      const counts = plan.items.filter((entry) => entry.status === STATUS.NEEDS_USER).length
      return textResult(`${item.id} 已挂起等你回答（当前 ${counts} 项）。问题已写入 questions.md。\n${summaryLine(plan)}`)
    },
  })

  const update = defineTool({
    name: 'plan_update',
    description:
      'Change the plan. action="add" appends lines (same format as plan_create); ' +
      'action="edit" rewrites one item (text/done_when/type); action="remove" deletes one item and REQUIRES a reason; ' +
      'action="reset" puts one item back to todo. Every change is logged.',
    parameters: {
      action: { type: 'string', description: 'add | edit | remove | reset' },
      id: { type: 'string', description: 'Item id for edit/remove/reset.' },
      lines: { type: 'array', items: { type: 'string' }, description: 'New item lines for action="add".' },
      text: { type: 'string', description: 'New text for action="edit".' },
      done_when: { type: 'string', description: 'New criterion for action="edit".' },
      type: { type: 'string', description: 'required | optional for action="edit".' },
      reason: { type: 'string', description: 'Required for action="remove" and action="reset".' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => renderTool(value) },
    async execute (args, exec) {
      const { plan } = await manager.requireWithCwd(exec.agent)
      const action = String(args.action ?? '').trim()
      if (action === 'add') {
        const added = addItems(plan, args.lines ?? [])
        await manager.persist(plan, { action: 'add', ids: added.map((item) => item.id) })
        return textResult(`已加 ${added.length} 项：${added.map((item) => `${item.id} ${item.text}`).join('；')}\n${summaryLine(plan)}`)
      }
      if (action === 'edit') {
        editItem(plan, args.id, { text: args.text, doneWhen: args.done_when, type: args.type })
        await manager.persist(plan, { action: 'edit', id: args.id })
        return textResult(`已修改 ${args.id}。\n${summaryLine(plan)}`)
      }
      if (action === 'remove') {
        removeItem(plan, args.id, args.reason)
        await manager.persist(plan, { action: 'remove', id: args.id, reason: args.reason })
        return textResult(`已删除 ${args.id}（原因已记录）。\n${summaryLine(plan)}`)
      }
      if (action === 'reset') {
        resetItem(plan, args.id, args.reason)
        await manager.persist(plan, { action: 'reset', id: args.id, reason: args.reason })
        return textResult(`${args.id} 已回到待办。\n${summaryLine(plan)}`)
      }
      throw new Error('plan_update needs action = add | edit | remove | reset')
    },
  })

  return [create, status, check, needs, update]
}
