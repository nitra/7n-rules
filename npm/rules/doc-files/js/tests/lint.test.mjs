import { describe, expect, test, vi, beforeEach } from 'vitest'
import { join } from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'

import { withTmpDir, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'
import { crc32, stampDoc } from '../docgen-crc.mjs'

// Стабільний wrapper над спільним ядром генерації: opportunistic-шлях lint() ліниво
// імпортує runGenerationBatch — підмінюємо стабільною функцією, що делегує у мутабельний
// state.impl (кожен тест задає свій), щоб юніт-тести лишались герметичними (без omlx).
const { state } = vi.hoisted(() => ({ state: { impl: async () => 0, calls: [] } }))
vi.mock('../docgen-files-batch.mjs', () => ({
  runGenerationBatch: (...args) => {
    state.calls.push(args)
    return state.impl(...args)
  },
  purgeOrphanedDocs: () => state.purgeImpl?.() ?? 0
}))

const { lint } = await import('../lint.mjs')

/**
 * Пише джерело й свіжу доку (CRC збігається) у тимчасовому корені.
 * @param {string} root корінь
 * @param {string} rel posix-шлях джерела
 * @param {string} body вміст джерела
 */
async function writeSourceWithFreshDoc(root, rel, body) {
  await ensureDir(join(root, rel, '..'))
  await writeFile(join(root, rel), body)
  const docRel = join(rel, '..', 'docs', `${rel.split('/').at(-1).replace(/\.\w+$/u, '')}.md`)
  await ensureDir(join(root, docRel, '..'))
  await writeFile(join(root, docRel), stampDoc('# x\n\n## Огляд\n\nтест\n', rel, crc32(Buffer.from(body))))
}

beforeEach(() => {
  state.impl = async () => 0
  state.calls = []
})

describe('lint — детект (readOnly: CI/hook, 0 LLM)', () => {
  test('ci (files=undefined): ловить відсутню доку у дереві', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      expect(await lint(undefined, root, { readOnly: true })).toBe(1)
      expect(state.calls).toHaveLength(0)
    })
  })

  test('ci: свіжа дока → 0', async () => {
    await withTmpDir(async root => {
      await writeSourceWithFreshDoc(root, 'src/a.mjs', 'export const a = 1\n')
      expect(await lint(undefined, root, { readOnly: true })).toBe(0)
    })
  })

  test('quick: змінене джерело без доки → 1; порожній набір → 0', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      expect(await lint(['src/a.mjs'], root, { readOnly: true })).toBe(1)
      expect(await lint([], root, { readOnly: true })).toBe(0)
    })
  })

  test('quick: реверс-мапінг — змінена дока веде до перевірки джерела', async () => {
    await withTmpDir(async root => {
      await writeSourceWithFreshDoc(root, 'src/a.mjs', 'export const a = 1\n')
      // Джерело змінилось, але у наборі лише шлях доки → мапінг має знайти джерело й виявити mismatch.
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 2\n')
      expect(await lint(['src/docs/a.md'], root, { readOnly: true })).toBe(1)
    })
  })

  test('quick: ігнорує не-кандидати (тести, node_modules)', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.test.mjs'), 'test\n')
      expect(await lint(['src/a.test.mjs'], root, { readOnly: true })).toBe(0)
    })
  })
})

describe('lint — opportunistic LLM-fix (fix-by-default)', () => {
  test('omlx up: генерує stale → re-detect 0', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      // «Генерація» = записати свіжу доку для кожної цілі (CRC збігається з джерелом).
      state.impl = async (targets, r) => {
        for (const t of targets) {
          const body = await readFile(join(r, t.sourcePath))
          await ensureDir(join(r, t.docPath, '..'))
          await writeFile(join(r, t.docPath), stampDoc('# x\n\n## Огляд\n\nтест\n', t.sourcePath, crc32(body)))
        }
        return 0
      }
      expect(await lint(['src/a.mjs'], root, { llmFix: true })).toBe(0)
      expect(state.calls).toHaveLength(1)
      expect(state.calls[0][0]).toHaveLength(1) // targets = 1 stale
    })
  })

  test('omlx down: fix пропущено → exit 1 (гейт тримається)', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      state.impl = async () => 1 // preflight-фейл: нічого не згенеровано
      expect(await lint(['src/a.mjs'], root, { llmFix: true })).toBe(1)
      expect(state.calls).toHaveLength(1)
    })
  })

  test('свіже дерево: генерацію не чіпаємо', async () => {
    await withTmpDir(async root => {
      await writeSourceWithFreshDoc(root, 'src/a.mjs', 'export const a = 1\n')
      expect(await lint(['src/a.mjs'], root, { llmFix: true })).toBe(0)
      expect(state.calls).toHaveLength(0)
    })
  })

  test('без llmFix: detect-only (stale → 1, генерацію не чіпаємо)', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      expect(await lint(['src/a.mjs'], root)).toBe(1) // llmFix=undefined → opt-out
      expect(state.calls).toHaveLength(0)
    })
  })
})
