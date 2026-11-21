import { readFileSync } from 'node:fs'
import path from 'node:path'

const dir = process.argv[2] ?? process.cwd()
const zh = readFileSync(path.join(dir, 'README.md'), 'utf8')
const en = readFileSync(path.join(dir, 'README.en.md'), 'utf8')
const stub = readFileSync(path.join(dir, 'README.zh.md'), 'utf8')

const checks = {
  chineseIsDefault: zh.includes('**中文**') && zh.includes('[English](README.en.md)'),
  englishLinksChinese: en.includes('**English**') && en.includes('[中文](README.md)'),
  stubOnlyRedirects: stub.length < 700 && stub.includes('README.md') && !stub.includes('### 7.'),
}

console.log(`README-ORDER-OK: ${JSON.stringify(checks)}`)
if (Object.values(checks).some((value) => !value)) process.exit(1)
