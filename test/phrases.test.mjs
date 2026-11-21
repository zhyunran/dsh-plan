import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyUserText, messageText } from '../lib/phrases.js'

test('the run instruction is recognized', () => {
  for (const text of ['我没说停就不停', '直到我说停', '现在工作', '继续工作，不用停']) {
    assert.equal(classifyUserText(text).kind, 'run', text)
  }
})

test('negated stop words never pause', () => {
  for (const text of ['不要停', '别停', '我没说停', '不许停']) {
    assert.notEqual(classifyUserText(text).kind, 'stop', text)
  }
})

test('explicit stop phrases pause', () => {
  for (const text of ['停', '停。', '先停一下', '急停', '暂停', '全部停', '别干了']) {
    assert.equal(classifyUserText(text).kind, 'stop', text)
  }
})

test('leaving is not stopping', () => {
  for (const text of ['我走了', '我先离开', '我去睡了', '回来要是没结果我就删对话']) {
    assert.equal(classifyUserText(text).kind, 'none', text)
  }
})

test('resume only counts while paused', () => {
  assert.equal(classifyUserText('继续', { paused: true }).kind, 'resume')
  assert.equal(classifyUserText('继续', { paused: false }).kind, 'none')
})

test('messageText reads text blocks only', () => {
  const text = messageText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })
  assert.equal(text, 'a\nb')
})

test('a rejection is recognized only when something is parked on the user', async () => {
  const { classifyRejection } = await import('../lib/phrases.js')
  assert.equal(classifyRejection('P3 不对，封面不像', { hasNeedsUser: true }).reject, true)
  assert.equal(classifyRejection('P3 不对，封面不像', { hasNeedsUser: true }).itemId, 'P3')
  assert.equal(classifyRejection('P2 不行', { hasNeedsUser: false }).reject, false)
  assert.equal(classifyRejection('好的，收到', { hasNeedsUser: true }).reject, false)
})
