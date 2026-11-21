import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gateDecision } from '../lib/gates.js'

const pwsh = (command) => ({ name: 'pwsh', arguments: { command } })

test('archiving a session asks the user', () => {
  const decision = gateDecision({ name: 'cross_session_kill', arguments: { to: 'session-x' } })
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /archives|terminates/)
})

test('other tools are not gated', () => {
  assert.equal(gateDecision({ name: 'write', arguments: { file_path: 'a.txt' } }), undefined)
  assert.equal(gateDecision({ name: 'cross_session_send', arguments: {} }), undefined)
})

test('deleting an existing directory asks the user', () => {
  const decision = gateDecision(pwsh('Remove-Item -Recurse -Force D:\\Minecraft\\saves'))
  assert.equal(decision.kind, 'ask')
})

test('deleting a file with rm asks the user', () => {
  assert.equal(gateDecision(pwsh('rm -rf /home/user/project')).kind, 'ask')
  assert.equal(gateDecision(pwsh('rd /s /q D:\\work')).kind, 'ask')
})

test('scratch cleanup under temp does not ask', () => {
  const temp = process.env.TEMP ?? process.env.TMP ?? 'C:\\Users\\x\\AppData\\Local\\Temp'
  assert.equal(gateDecision(pwsh(`Remove-Item -Recurse "${temp}\\build-cache"`)), undefined)
})

test('non-delete commands do not ask', () => {
  assert.equal(gateDecision(pwsh('npm run build')), undefined)
  assert.equal(gateDecision(pwsh('git status')), undefined)
  assert.equal(gateDecision(pwsh('Get-ChildItem .')), undefined)
})

test('a delete word inside a quoted log line does not ask', () => {
  assert.equal(gateDecision(pwsh('Write-Output "Remove-Item was blocked by dsh-plan"')), undefined)
  assert.equal(gateDecision(pwsh("Set-Content log.txt -Value 'rm -rf is documented here'")), undefined)
})

test('the delete gate can be switched off', () => {
  assert.equal(gateDecision(pwsh('rm -rf /home/user/project'), { deleteGate: false }), undefined)
})
