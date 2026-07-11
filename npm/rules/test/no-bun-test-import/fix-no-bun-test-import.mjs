/**
 * T0-autofix для `test/no-bun-test-import`: переписує `from 'bun:test'` на
 * `from 'vitest'` у import-декларацій, чиї специфікатори мають прямий 1:1
 * еквівалент у vitest (describe/test/it/expect/beforeEach/beforeAll/afterEach/afterAll). Import-и з
 * mock/spyOn/jest тощо НЕ чіпаються — там потрібне ручне виправлення call-sites
 * (`vi.fn`/`vi.spyOn` мають інший API за межами самого import), детектор лишає
 * їх як violation для ручного/LLM-ladder фіксу.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { findBunTestImports } from './main.mjs'

const QUOTED_BUN_TEST_RE = /(['"])bun:test\1/u

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'rewrite-bun-test-import-to-vitest',
    test: violations => violations.some(v => v.reason === 'bun-test-import' && v.data?.fixable),
    apply: async (violations, ctx) => {
      const files = [
        ...new Set(violations.filter(v => v.reason === 'bun-test-import' && v.data?.fixable).map(v => v.file))
      ]

      const touchedFiles = []
      for (const file of files) {
        const absPath = join(ctx.cwd, file)
        const content = await readFile(absPath, 'utf8')
        const found = findBunTestImports(content)
        if (found.length === 0) continue

        let next = content
        // Заміняємо з кінця файлу до початку, щоб офсети попередніх матчів не зсувались.
        for (const imp of found.toReversed()) {
          if (!imp.fixable) continue
          const rewritten = imp.raw.replace(QUOTED_BUN_TEST_RE, (_match, quote) => `${quote}vitest${quote}`)
          next = next.slice(0, imp.start) + rewritten + next.slice(imp.end)
        }
        if (next === content) continue

        ctx.recordWrite?.(absPath)
        await writeFile(absPath, next, 'utf8')
        touchedFiles.push(absPath)
      }

      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `bun:test → vitest: ${touchedFiles.join(', ')}` }
    }
  }
]
