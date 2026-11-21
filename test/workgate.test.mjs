import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPlan, pause } from '../lib/model.js'
import { workGateDecision } from '../lib/workgate.js'

function plan (count = 7) {
  return createPlan({
    sessionId: 'session-work',
    cwd: 'C:/work',
    lines: Array.from({ length: count }, (_, index) => `任务${index + 1} || 可观察结果${index + 1}`),
  })
}

test('state-changing work without a plan is refused', () => {
  for (const tool of ['write', 'edit', 'pwsh', 'bash', 'app_launch', 'subagent', 'workflow']) {
    const decision = workGateDecision(tool, undefined, {})
    assert.equal(decision.kind, 'deny', tool)
    assert.match(decision.reason, /plan_create/)
  }
})

test('reads, questions and plan tools are never gated', () => {
  for (const tool of ['read', 'grep', 'glob', 'web_search', 'ask_user_question', 'plan_create', 'plan_check']) {
    assert.equal(workGateDecision(tool, undefined, {}), undefined, tool)
  }
})

test('an open required item allows work', () => {
  assert.equal(workGateDecision('write', plan(), {}), undefined)
})

test('a paused plan refuses work', () => {
  const created = plan()
  pause(created, 'user stop')
  const decision = workGateDecision('write', created, {})
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /暂停/)
})

test('a completed plan refuses new work until a new item is added', () => {
  const created = plan()
  for (const item of created.items) item.status = 'done'
  const decision = workGateDecision('edit', created, {})
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /没有开放项/)
})

test('optional-only todos do not open the gate', () => {
  const created = plan(7)
  for (const item of created.items) item.status = 'done'
  created.items.push({ id: 'P8', text: '可选', done_when: 'x', type: 'optional', check: 'evidence', status: 'todo' })
  const decision = workGateDecision('write', created, {})
  assert.equal(decision.kind, 'deny')
})

test('a stalled plan with an open item still allows work', () => {
  const created = plan()
  created.stalled = true
  assert.equal(workGateDecision('write', created, {}), undefined)
})

test('the gate can be switched off', () => {
  assert.equal(workGateDecision('write', undefined, { requireOpenItemForWork: false }), undefined)
})
