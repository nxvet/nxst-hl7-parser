// Guards the published surface of the package.
//
// The package is imported by its own name, so Node resolves it through the `exports` map of
// package.json (package self-reference) and loads the compiled `dist/`, exactly as a consumer
// would. A broken `exports` map, a missing build output, or a symbol that was added or removed
// without updating this list fails here. `npm test` builds `dist/` first (see `pretest`).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import * as published from '@nxvet/nxst-hl7-parser'

/** Every runtime export, sorted. Types (`Hl7Segment`, `MllpExtraction`) have no runtime value. */
const EXPECTED_RUNTIME_EXPORTS = [
  'MLLP_CR',
  'MLLP_END',
  'MLLP_START',
  'component',
  'extractMllpFrames',
  'field',
  'findSegment',
  'findSegments',
  'hl7Timestamp',
  'hl7TimestampWithOffset',
  'normalizeHl7Date',
  'parseMessage',
  'sanitizeHl7Text',
  'wrapMllp',
]

interface PackageJson {
  name: string
  types: string
  files: string[]
  exports: Record<string, string | Record<string, string>>
  dependencies?: Record<string, string>
}

const packageRoot = new URL('../', import.meta.url)
const packageJson = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf-8')) as PackageJson

/** True when `target` (a `./`-relative path) is shipped by one of the `files` entries. */
const isShipped = (target: string): boolean => {
  const relative = target.replace(/^\.\//, '')

  return relative === 'package.json'
    || packageJson.files.some((entry) => relative === entry || relative.startsWith(`${entry}/`))
}

describe('published entry point', () => {
  it('exposes exactly the documented runtime exports', () => {
    assert.deepEqual(Object.keys(published).sort(), [...EXPECTED_RUNTIME_EXPORTS].sort())
  })

  it('exposes functions and the three MLLP byte constants', () => {
    assert.equal(published.MLLP_START, 0x0b)
    assert.equal(published.MLLP_END, 0x1c)
    assert.equal(published.MLLP_CR, 0x0d)

    for (const name of EXPECTED_RUNTIME_EXPORTS.filter((key) => key.startsWith('MLLP_') === false)) {
      assert.equal(typeof published[name as keyof typeof published], 'function', `${name} should be a function`)
    }
  })

  it('resolves to the compiled JavaScript in dist/, not to the TypeScript sources', () => {
    const resolved = fileURLToPath(import.meta.resolve('@nxvet/nxst-hl7-parser'))

    assert.equal(resolved, fileURLToPath(new URL('dist/index.js', packageRoot)))
  })

  it('works end to end through the package name', () => {
    const { frames } = published.extractMllpFrames(Buffer.from(published.wrapMllp('MSH|^~\\&|APP||||20250310131500+0900||ACK|1|P|2.4')))
    const msh = published.findSegment(published.parseMessage(frames[0]), 'MSH')

    assert.equal(published.field(msh, 3), 'APP')
    assert.equal(published.normalizeHl7Date(published.field(msh, 7)), '20250310131500')
  })
})

describe('package.json', () => {
  it('has no runtime dependencies', () => {
    assert.equal(packageJson.dependencies, undefined)
  })

  it('points every exports target and the types entry at a file that exists and is shipped', () => {
    const targets = [packageJson.types]

    for (const value of Object.values(packageJson.exports)) {
      targets.push(...(typeof value === 'string' ? [value] : Object.values(value)))
    }

    for (const target of targets) {
      assert.equal(existsSync(new URL(target, packageRoot)), true, `${target} should exist after the build`)
      assert.equal(isShipped(target), true, `${target} should be covered by the "files" list`)
    }
  })

  it('ships the documentation and the license', () => {
    for (const file of ['README.md', 'README.zh.md', 'CHANGELOG.md', 'LICENSE']) {
      assert.equal(packageJson.files.includes(file), true, `${file} should be in "files"`)
      assert.equal(existsSync(new URL(file, packageRoot)), true, `${file} should exist`)
    }
  })
})
