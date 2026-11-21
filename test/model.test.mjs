import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHECKS, STATUS, TYPES,
  addItems, checkItem, createPlan, needsUser, nextItem, removeItem, resetItem, stopAllowed, createPlan as make,
} from '../lib/model.js'

const LINE = '做一件事 || 一个可观察的结果'

function plan (count = 7, extra = []) {
  return createPlan({
    sessionId: 'session-test',
    cwd: 'C:/work',
    lines: [...Array.from({ length: count }, (_, index) => `任务${index + 1} || 可观察结果${index + 1}`), ...extra],
  })
}

test('a plan refuses fewer than 7 required items', () => {
  assert.throws(() => plan(6), /at least 7 required items/)
})

test('a plan accepts exactly 7 and assigns P ids', () => {
  const created = plan(7)
  assert.equal(created.items.length, 7)
  assert.equal(created.items[0].id, 'P1')
  assert.equal(created.items[0].status, STATUS.TODO)
})

test('an item without done_when is rejected', () => {
  assert.throws(() => createPlan({
    sessionId: 's', cwd: 'C:/work', lines: ['只有任务'],
  }), /needs a done_when/)
})

test('required todo blocks the end; done and needs_user allow it', () => {
  const created = plan(7)
  assert.equal(stopAllowed(created), false)

  for (const item of created.items) {
    if (item.status === STATUS.TODO) {
      item.status = STATUS.DONE
      item.evidence = 'log:x@y'
    }
  }
  assert.equal(stopAllowed(created), true)

  const second = plan(7)
  needsUser(second, 'P1', '要用户决定的问题')
  assert.equal(stopAllowed(second), false)
  for (const item of second.items.slice(1)) item.status = STATUS.DONE
  assert.equal(stopAllowed(second), true, 'needs_user must not block')
})

test('optional items never block', () => {
  const created = plan(7, ['可选任务 || 可选结果 || optional'])
  for (const item of created.items) item.status = STATUS.DONE
  created.items.find((item) => item.type === TYPES.OPTIONAL).status = STATUS.TODO
  assert.equal(stopAllowed(created), true)
})

test('required evidence items cannot be checked without evidence', () => {
  const created = plan(7)
  assert.throws(() => checkItem(created, 'P1'), /needs evidence/)
  checkItem(created, 'P1', 'sha256:a.txt@abcd1234')
  assert.equal(created.items[0].status, STATUS.DONE)
})

test('an auto item carries its witness and can be checked without an argument', () => {
  const created = plan(7, ['自动项 || 文件存在 || required || auto || exists:a.txt'])
  const item = created.items.at(-1)
  assert.equal(item.check, CHECKS.AUTO)
  checkItem(created, item.id)
  assert.equal(item.evidence, 'exists:a.txt')
})

test('removing an item requires a reason and is recorded', () => {
  const created = plan(7)
  assert.throws(() => removeItem(created, 'P1', ''), /needs a reason/)
  removeItem(created, 'P1', '合并到 P2')
  assert.equal(created.items.length, 6)
  assert.equal(created.removals.length, 1)
})

test('reset puts a needs_user item back to todo', () => {
  const created = plan(7)
  needsUser(created, 'P1', '问题')
  resetItem(created, 'P1', '用户已回答')
  assert.equal(created.items[0].status, STATUS.TODO)
  assert.equal(created.items[0].question, undefined)
})

test('next item is the first required todo', () => {
  const created = plan(7)
  created.items[0].status = STATUS.DONE
  assert.equal(nextItem(created).id, 'P2')
})

test('the tool view is lossless JSON (no undefined fields)', async () => {
  const { planView } = await import('../lib/render.js')
  const view = planView(plan(7))
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view)
  assert.equal(Object.values(view).includes(undefined), false)
})

test('a rejected acceptance reopens the plan with one new required fix item', async () => {
  const { rejectNeedsUser } = await import('../lib/model.js')
  const created = plan(7)
  needsUser(created, 'P1', '封面像不像原版？')
  const { target, item } = rejectNeedsUser(created, { id: 'P1', reason: '封面不像，太现代了' })
  assert.equal(target.status, STATUS.NEEDS_USER, 'the acceptance stays parked for re-review')
  assert.equal(target.reviewCount, 1)
  assert.equal(item.type, TYPES.REQUIRED)
  assert.equal(item.status, STATUS.TODO)
  assert.match(item.text, /按反馈修正/)
  assert.equal(stopAllowed(created), false, 'the plan is open again')
})

test('an ambiguous rejection without an id fails instead of guessing', async () => {
  const { rejectNeedsUser } = await import('../lib/model.js')
  const created = plan(7)
  needsUser(created, 'P1', '问题一')
  needsUser(created, 'P2', '问题二')
  assert.throws(() => rejectNeedsUser(created, { reason: '不行' }), /ambiguous rejection/)
})

test('the dock payload says exactly when the turn is held', async () => {
  const { statePayload } = await import('../lib/render.js')
  const created = plan(7)
  const held = statePayload(created)
  assert.equal(held.active, true)
  assert.equal(held.enforced, true, 'a required todo means the turn is held')
  assert.equal(held.canEnd, false)
  assert.equal(held.next.id, 'P1')

  for (const item of created.items) item.status = STATUS.DONE
  const clear = statePayload(created)
  assert.equal(clear.enforced, false)
  assert.equal(clear.canEnd, true)
  assert.equal(clear.next, null)

  assert.equal(statePayload(undefined).active, false)
})

test('the composer switch turns enforcement off and on', async () => {
  const { statePayload } = await import('../lib/render.js')
  const created = plan(7)
  assert.equal(statePayload(created, true).enforced, true)
  assert.equal(statePayload(created, false).enabled, false)
  assert.equal(statePayload(created, false).enforced, false, 'switched off means nothing is held')
  assert.equal(statePayload(undefined, false).enabled, false)
})

test('the per-session switch persists on disk', async () => {
  const { mkdtemp } = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { loadSettings, saveSettings } = await import('../lib/store.js')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-plan-settings-'))
  assert.equal(await loadSettings(dir, 'session-x'), undefined, 'missing file means the default')
  await saveSettings(dir, 'session-x', { enabled: false })
  assert.deepEqual(await loadSettings(dir, 'session-x'), { enabled: false })
  await saveSettings(dir, 'session-x', { enabled: true })
  assert.deepEqual(await loadSettings(dir, 'session-x'), { enabled: true })
})

test('archiving retires the current plan and keeps it for the viewer', async () => {
  const { mkdtemp } = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const { archivePlan, listArchives, loadPlan, savePlan } = await import('../lib/store.js')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-plan-archive-'))
  const sessionId = 'session-work'
  const created = plan(7)
  await savePlan(dir, created)
  assert.equal((await listArchives(dir, sessionId)).length, 0)

  await archivePlan(dir, sessionId, created, 'interrupted')
  assert.equal(await loadPlan(dir, sessionId), undefined, 'the current slot is empty after archiving')

  const archives = await listArchives(dir, sessionId)
  assert.equal(archives.length, 1)
  assert.equal(archives[0].reason, 'interrupted')
  assert.equal(archives[0].items.length, 7)
})

test('a paused plan is still retired by a new round', async () => {
  const { archiveDecision, pause } = await import('../lib/model.js')
  const created = plan(7)
  pause(created, 'runtime abort')
  const decision = archiveDecision(created)
  assert.equal(decision.reason, 'stopped', 'the paused plan must not sit in the slot forever')
  assert.equal(decision.interrupted, true, 'open items make it an interruption')
})

test('a completed plan is retired as completed', async () => {
  const { archiveDecision } = await import('../lib/model.js')
  const created = plan(7)
  for (const item of created.items) item.status = STATUS.DONE
  assert.deepEqual(archiveDecision(created), { reason: 'completed', interrupted: false })
})

test('run mode and parked questions keep the plan', async () => {
  const { archiveDecision } = await import('../lib/model.js')
  const running = plan(7)
  running.mode = 'run'
  assert.equal(archiveDecision(running), null, 'a steering message during a run does not retire it')

  const parked = plan(7)
  needsUser(parked, 'P1', '要不要换方案？')
  assert.equal(archiveDecision(parked), null, 'the message may be the answer')

  assert.equal(archiveDecision(undefined), null)
})

test('the plan size upper bound is enforced', () => {
  const eight = Array.from({ length: 8 }, (_, index) => `任务${index + 1} || 结果${index + 1}`)
  assert.throws(
    () => createPlan({ sessionId: 's', cwd: 'C:/w', lines: eight, minRequired: 7, maxRequired: 7 }),
    /at most 7 required items/,
  )
  const seven = createPlan({ sessionId: 's', cwd: 'C:/w', lines: eight.slice(0, 7), minRequired: 7, maxRequired: 7 })
  assert.equal(seven.items.length, 7)
})

test('the configured range is reported in the error message', () => {
  const six = Array.from({ length: 6 }, (_, index) => `任务${index + 1} || 结果${index + 1}`)
  assert.throws(
    () => createPlan({ sessionId: 's', cwd: 'C:/w', lines: six, minRequired: 3, maxRequired: 4 }),
    /at most 4 required items/,
  )
})

test('without a maximum the plan is unbounded', () => {
  const many = Array.from({ length: 20 }, (_, index) => `任务${index + 1} || 结果${index + 1}`)
  assert.equal(createPlan({ sessionId: 's', cwd: 'C:/w', lines: many, minRequired: 7 }).items.length, 20)
})
