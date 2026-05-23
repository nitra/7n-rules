import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findMissingMdcRefs } from '../check-mdc-template-refs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '__fixtures__', 'mdc-refs')

describe('findMissingMdcRefs', () => {
  test('returns empty when every template/ file is linked from <id>.mdc', async () => {
    const ruleDir = join(FIXTURES, 'with-refs')
    expect(await findMissingMdcRefs(ruleDir, 'with-refs')).toEqual([])
  })

  test('returns missing template files', async () => {
    const ruleDir = join(FIXTURES, 'missing-ref')
    const missing = await findMissingMdcRefs(ruleDir, 'missing-ref')
    expect(missing).toEqual(['policy/bar/template/.gitleaks.toml.snippet.toml'])
  })

  test('returns empty for rule without template/ dirs', async () => {
    const ruleDir = join(FIXTURES, 'no-templates')
    expect(await findMissingMdcRefs(ruleDir, 'no-templates')).toEqual([])
  })
})
