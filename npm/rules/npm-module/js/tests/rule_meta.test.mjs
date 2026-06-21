import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../rule_meta.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

/** Мінімальний валідний .mdc — щоб тест перевіряв лише свою умову, а не відсутність mdc. */
const MK_MDC = async (dir, id) =>
  writeFile(join(dir, 'npm', 'rules', id, `${id}.mdc`), `---\ndescription: stub\n---\n`, 'utf8')

describe('rule_meta check', () => {
  test('валідні meta.json (усі форми) → 0', async () => {
    await withTmpDir(async dir => {
      const mk = async (id, meta) => {
        await ensureDir(join(dir, 'npm', 'rules', id))
        await writeJson(join(dir, 'npm', 'rules', id, 'meta.json'), meta)
        await MK_MDC(dir, id)
      }
      await mk('adr', { auto: 'завжди' })
      await mk('changelog', { auto: ['bun'] })
      await mk('vue', { auto: { glob: '**/*.vue' } })
      await mk('abie', { auto: { predicate: 'repoUrlMarker', arg: 'x' } })
      await mk('ci4', {})
      expect(await check(dir)).toBe(0)
    })
  })

  test('відсутній {id}.mdc → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'adr'))
      await writeJson(join(dir, 'npm', 'rules', 'adr', 'meta.json'), { auto: 'завжди' })
      // навмисно без adr.mdc
      expect(await check(dir)).toBe(1)
    })
  })

  test('відсутній meta.json → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'adr'))
      await MK_MDC(dir, 'adr')
      expect(await check(dir)).toBe(1)
    })
  })

  test('залишковий auto.md → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'adr'))
      await writeJson(join(dir, 'npm', 'rules', 'adr', 'meta.json'), { auto: 'завжди' })
      await MK_MDC(dir, 'adr')
      await writeFile(join(dir, 'npm', 'rules', 'adr', 'auto.md'), 'завжди\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('нерозпізнаний auto → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'x'))
      await writeJson(join(dir, 'npm', 'rules', 'x', 'meta.json'), { auto: 'always' })
      await MK_MDC(dir, 'x')
      expect(await check(dir)).toBe(1)
    })
  })

  test('невідомий predicate → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'x'))
      await writeJson(join(dir, 'npm', 'rules', 'x', 'meta.json'), { auto: { predicate: 'bogusPredicate' } })
      await MK_MDC(dir, 'x')
      expect(await check(dir)).toBe(1)
    })
  })

  test('немає npm/rules → 0', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('lint:"per-file" без lint-export у main.mjs → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'x'))
      await writeJson(join(dir, 'npm', 'rules', 'x', 'meta.json'), { lint: 'per-file' })
      await MK_MDC(dir, 'x')
      await writeFile(join(dir, 'npm', 'rules', 'x', 'main.mjs'), 'export function run(){return 0}\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('lint:"per-file" з lint-export у main.mjs → 0', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'x'))
      await writeJson(join(dir, 'npm', 'rules', 'x', 'meta.json'), { lint: 'per-file' })
      await MK_MDC(dir, 'x')
      await writeFile(join(dir, 'npm', 'rules', 'x', 'main.mjs'), 'export function lint(){return 0}\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('lint:"full" з re-export lint у main.mjs → 0', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'x'))
      await writeJson(join(dir, 'npm', 'rules', 'x', 'meta.json'), { lint: 'full' })
      await MK_MDC(dir, 'x')
      await writeFile(join(dir, 'npm', 'rules', 'x', 'main.mjs'), "export { lint } from './js/lint.mjs'\n", 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('lint нерозпізнане (стара фаза "quick") → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'rules', 'x'))
      await writeJson(join(dir, 'npm', 'rules', 'x', 'meta.json'), { lint: 'quick' })
      await MK_MDC(dir, 'x')
      expect(await check(dir)).toBe(1)
    })
  })
})
