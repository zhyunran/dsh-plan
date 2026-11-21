import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { verifyEvidence } from '../lib/evidence.js'

async function fixture () {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-plan-test-'))
  const file = path.join(dir, 'artifact.txt')
  await writeFile(file, 'BUILD SUCCESSFUL\n', 'utf8')
  const hash = createHash('sha256').update('BUILD SUCCESSFUL\n').digest('hex')
  return { dir, file, hash }
}

test('sha256 evidence verifies a real file hash prefix', async () => {
  const { file, hash } = await fixture()
  const result = await verifyEvidence(`sha256:${file}@${hash.slice(0, 16)}`)
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'sha256')
})

test('a hash mismatch is rejected', async () => {
  const { file } = await fixture()
  await assert.rejects(() => verifyEvidence(`sha256:${file}@0000000000000000`), /hash mismatch/)
})

test('log evidence finds a substring', async () => {
  const { file } = await fixture()
  const result = await verifyEvidence(`log:${file}@BUILD SUCCESSFUL`)
  assert.equal(result.kind, 'log')
})

test('log evidence rejects a missing substring', async () => {
  const { file } = await fixture()
  await assert.rejects(() => verifyEvidence(`log:${file}@NOT THERE`), /not found/)
})

test('unknown formats are rejected with guidance', async () => {
  await assert.rejects(() => verifyEvidence('because I said so', process.cwd()), /unknown evidence format/)
})
