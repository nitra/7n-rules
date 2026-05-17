import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadTemplate } from './template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '__fixtures__', 'template')

describe('loadTemplate', () => {
  test('reads snippet/deny/contains from policy/<concern>/template/ for package.json target', async () => {
    const concernDir = join(FIXTURES, 'security-pkgjson', 'policy', 'package_json')
    const tpl = await loadTemplate(concernDir)
    expect(tpl).toEqual({
      'package.json': {
        snippet: { scripts: { 'lint-security': 'gitleaks detect --no-banner' } },
        deny: {
          dependencies: { gitleaks: 'глобальний CLI — не додавай у dependencies' },
          devDependencies: { gitleaks: 'глобальний CLI — не додавай у devDependencies' }
        },
        contains: { scripts: { lint: ['bun run lint-security'] } }
      }
    })
  })

  test('returns empty object when template/ missing', async () => {
    const concernDir = join(FIXTURES, 'empty-concern', 'policy', 'empty')
    const tpl = await loadTemplate(concernDir)
    expect(tpl).toEqual({})
  })
})
