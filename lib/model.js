/**
 * The task-plan state machine.
 *
 * A plan is a flat list of checkboxes plus one rule:
 *
 *   a turn may end when no *required* item is still `todo`
 *
 * `done` and `needs_user` both allow the end; `optional` items never block.
 * There is no score, no evidence score, no attempt to read intent.
 *
 * @module dsh-plan/model
 */

export const STATUS = Object.freeze({
  TODO: 'todo',
  DONE: 'done',
  NEEDS_USER: 'needs_user',
})

export const TYPES = Object.freeze({ REQUIRED: 'required', OPTIONAL: 'optional' })
export const CHECKS = Object.freeze({ EVIDENCE: 'evidence', AUTO: 'auto' })

/** Item ids are per plan: one session has one plan, so P1..Pn stay readable. */
function nextId (plan) {
  const serial = Number(plan.nextSerial ?? (plan.items.length + 1))
  plan.nextSerial = serial + 1
  return `P${serial}`
}

function fail (message) {
  const error = new Error(message)
  error.name = 'PlanError'
  throw error
}

/** Split one `P: text || criterion || flags` line into its parts. */
function parseItemLine (line) {
  const raw = String(line ?? '').trim()
  if (raw.length === 0) fail('empty plan item')
  const parts = raw.split('||').map((part) => part.trim())
  const text = parts[0] ?? ''
  const doneWhen = parts[1] ?? ''
  if (text.length === 0) fail(`plan item has no text: ${raw}`)
  if (doneWhen.length === 0) fail(`plan item "${text}" needs a done_when criterion (use "text || criterion")`)

  let type = TYPES.REQUIRED
  let check = CHECKS.EVIDENCE
  let witness
  for (const flag of parts.slice(2)) {
    const value = flag.toLowerCase()
    if (value === TYPES.OPTIONAL || value === TYPES.REQUIRED) type = value
    else if (value === CHECKS.AUTO || value === CHECKS.EVIDENCE) check = value
    else if (value.length > 0) witness = flag
  }
  if (check === CHECKS.AUTO && typeof witness !== 'string') {
    fail(`plan item "${text}" uses check "auto" and needs a witness, e.g. sha256:<path>@<hex> / exists:<path> / log:<path>@<text>`)
  }
  return { text, doneWhen, type, check, ...(witness ? { witness } : {}) }
}

/**
 * Build one checked-in plan.
 *
 * @param {{
 *   sessionId: string, cwd: string, mode?: 'task'|'run',
 *   lines: string[], minRequired?: number, now?: number,
 * }} input
 */
export function createPlan (input) {
  const sessionId = String(input.sessionId ?? '')
  const cwd = String(input.cwd ?? '')
  if (sessionId.length === 0) fail('plan needs a session id')
  if (cwd.length === 0) fail('plan needs a session working directory')

  const plan = {
    version: 1,
    sessionId,
    cwd,
    mode: input.mode === 'run' ? 'run' : 'task',
    createdAt: input.now ?? Date.now(),
    updatedAt: input.now ?? Date.now(),
    paused: false,
    pausedReason: '',
    forced: 0,
    stalled: false,
    nextSerial: 1,
    items: [],
  }

  plan.items = (input.lines ?? []).map(parseItemLine).map((item) => ({
    id: nextId(plan),
    text: item.text,
    done_when: item.doneWhen,
    type: item.type,
    check: item.check,
    ...(item.witness ? { witness: item.witness } : {}),
    status: STATUS.TODO,
  }))

  const required = plan.items.filter((item) => item.type === TYPES.REQUIRED)
  const minRequired = input.minRequired ?? 7
  if (required.length < minRequired) {
    fail(`a plan needs at least ${minRequired} required items (got ${required.length}). Break the task down further.`)
  }

  return plan
}

/** Append item lines to an existing plan. */
export function addItems (plan, lines) {
  const added = (lines ?? []).map(parseItemLine).map((item) => ({
    id: nextId(plan),
    text: item.text,
    done_when: item.doneWhen,
    type: item.type,
    check: item.check,
    ...(item.witness ? { witness: item.witness } : {}),
    status: STATUS.TODO,
  }))
  plan.items.push(...added)
  touch(plan)
  return added
}

/** Append one item from explicit fields (used by the rejection flow). */
export function addItem (plan, { text, doneWhen, type = TYPES.REQUIRED, check = CHECKS.EVIDENCE, witness }) {
  if (String(text ?? '').trim().length === 0) fail('plan item needs text')
  if (String(doneWhen ?? '').trim().length === 0) fail('plan item needs done_when')
  const item = {
    id: nextId(plan),
    text: String(text).trim(),
    done_when: String(doneWhen).trim(),
    type,
    check,
    ...(witness ? { witness } : {}),
    status: STATUS.TODO,
  }
  plan.items.push(item)
  touch(plan)
  return item
}

/**
 * The user rejected a parked acceptance item: keep it parked for the next
 * review, and add one new required fix item so the plan reopens.
 *
 * @param {{ id?: string, reason?: string }} input
 */
export function rejectNeedsUser (plan, input) {
  const parked = plan.items.filter((item) => item.status === STATUS.NEEDS_USER)
  if (parked.length === 0) fail('there is no needs_user item to reject')
  let target
  if (input.id !== undefined) target = findItem(plan, input.id)
  else if (parked.length === 1) target = parked[0]
  else fail(`ambiguous rejection: ${parked.length} items are waiting on the user; name one (${parked.map((item) => item.id).join(', ')})`)
  if (target.status !== STATUS.NEEDS_USER) fail(`${target.id} is not waiting on the user`)

  const feedback = String(input.reason ?? '').trim()
  const item = addItem(plan, {
    text: `按反馈修正（${target.id}）：${feedback.slice(0, 80) || target.text}`,
    doneWhen: `修正完成并附证据（原问题：${target.question ?? target.text}）`,
    type: TYPES.REQUIRED,
    check: CHECKS.EVIDENCE,
  })
  target.reviewCount = Number(target.reviewCount ?? 0) + 1
  return { target, item }
}

/** Edit one item's text or criterion. */
export function editItem (plan, id, patch) {
  const item = findItem(plan, id)
  if (typeof patch.text === 'string' && patch.text.trim().length > 0) item.text = patch.text.trim()
  if (typeof patch.doneWhen === 'string' && patch.doneWhen.trim().length > 0) item.done_when = patch.doneWhen.trim()
  if (patch.type === TYPES.OPTIONAL || patch.type === TYPES.REQUIRED) item.type = patch.type
  touch(plan)
  return item
}

/** Remove one item. A removal always needs a reason and is recorded on the plan. */
export function removeItem (plan, id, reason) {
  const index = plan.items.findIndex((item) => item.id === id)
  if (index < 0) fail(`no plan item "${id}"`)
  if (String(reason ?? '').trim().length === 0) fail('removing a plan item needs a reason')
  const [removed] = plan.items.splice(index, 1)
  plan.removals = Array.isArray(plan.removals) ? plan.removals : []
  plan.removals.push({ id: removed.id, text: removed.text, reason: String(reason).trim(), at: Date.now() })
  touch(plan)
  return removed
}

/** Mark one item done. Optional items may skip evidence; required items may not. */
export function checkItem (plan, id, evidence) {
  const item = findItem(plan, id)
  if (item.status === STATUS.DONE) fail(`plan item ${id} is already done`)
  if (item.check === CHECKS.AUTO && (evidence === undefined || evidence === null)) evidence = item.witness
  if (item.check === CHECKS.EVIDENCE && item.type === TYPES.REQUIRED) {
    if (typeof evidence !== 'string' || evidence.trim().length === 0) {
      fail(`plan item ${id} needs evidence (sha256:<path>@<hex> or log:<path>@<text>) before it can be checked`)
    }
  }
  item.status = STATUS.DONE
  item.evidence = typeof evidence === 'string' ? evidence.trim() : undefined
  item.checkedAt = Date.now()
  touch(plan)
  return item
}

/** Park one item on the user: the plan may end with such items, and they become questions.md. */
export function needsUser (plan, id, question) {
  const item = findItem(plan, id)
  if (String(question ?? '').trim().length === 0) fail(`marking ${id} as needs_user needs the question the user must answer`)
  item.status = STATUS.NEEDS_USER
  item.question = String(question).trim()
  touch(plan)
  return item
}

/** Reset one item back to todo (after the user answered, or a rejected acceptance). */
export function resetItem (plan, id, reason) {
  const item = findItem(plan, id)
  item.status = STATUS.TODO
  item.evidence = undefined
  item.question = undefined
  item.resetReason = String(reason ?? '').trim()
  touch(plan)
  return item
}

/** Wait for the user: pause the plan (stop button and chat "鍋?). */
export function pause (plan, reason) {
  plan.paused = true
  plan.pausedReason = String(reason ?? 'user stop').trim()
  plan.updatedAt = Date.now()
  return plan
}

/** Resume a paused plan. */
export function resume (plan) {
  plan.paused = false
  plan.pausedReason = ''
  plan.forced = 0
  plan.stalled = false
  touch(plan)
  return plan
}

/** True when the turn may end: no required item is still todo. */
export function stopAllowed (plan) {
  return !plan.items.some((item) => item.type === TYPES.REQUIRED && item.status === STATUS.TODO)
}

/**
 * Should a new user message retire this plan?
 *
 * A new round always retires the previous plan, paused or not — otherwise a
 * plan paused by an abort would sit in the slot forever and every round would
 * show the same checklist. Two exceptions:
 *
 *   - run mode while unpaused (the user is steering one long job);
 *   - any plan with items parked on the user (the message may be the answer).
 *
 * @param {any} plan
 * @returns {null | { reason: 'stopped' | 'interrupted' | 'completed', interrupted: boolean }}
 */
export function archiveDecision (plan) {
  if (plan === undefined || plan === null) return null
  if (plan.items.some((item) => item.status === STATUS.NEEDS_USER)) return null
  if (plan.mode === 'run' && plan.paused !== true) return null
  const open = plan.items.some((item) => item.type === TYPES.REQUIRED && item.status === STATUS.TODO)
  const reason = plan.paused === true ? 'stopped' : open ? 'interrupted' : 'completed'
  return { reason, interrupted: open }
}

/** The next required item to work on. */
export function nextItem (plan) {
  return plan.items.find((item) => item.type === TYPES.REQUIRED && item.status === STATUS.TODO)
}

/** Counts for the status card. */
export function stats (plan) {
  const required = plan.items.filter((item) => item.type === TYPES.REQUIRED)
  const done = plan.items.filter((item) => item.status === STATUS.DONE)
  const needs = plan.items.filter((item) => item.status === STATUS.NEEDS_USER)
  return {
    total: plan.items.length,
    required: required.length,
    requiredDone: required.filter((item) => item.status === STATUS.DONE).length,
    done: done.length,
    needsUser: needs.length,
    optional: plan.items.filter((item) => item.type === TYPES.OPTIONAL).length,
  }
}

function findItem (plan, id) {
  const item = plan.items.find((candidate) => candidate.id === id)
  if (item === undefined) fail(`no plan item "${id}" (current ids: ${plan.items.map((entry) => entry.id).join(', ') || 'none'})`)
  return item
}

function touch (plan) {
  plan.updatedAt = Date.now()
  plan.stalled = false
  plan.forced = 0
  plan.removals = Array.isArray(plan.removals) ? plan.removals : []
}

