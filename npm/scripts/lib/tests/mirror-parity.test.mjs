/**
 * Тести parity дзеркала правил (`lib/mirror-parity.mjs`):
 *  - юніт: `findMirrorDrift` ловить розбіжність mirror↔канон у tmp-фікстурі;
 *  - юніт: розрізнення «зовнішнє дзеркало» (легітимний тихий пропуск) від «канон мав би
 *    бути в задекларованому, але незарезолвленому плагіні» (гучна помилка, а не тихе
 *    звуження обсягу — інакше `findMirrorDrift` бреше «дрейфу нема», реально нічого не
 *    перевіривши, spec `docs/plans/2026-08-05-open-questions-register.md` §2.42);
 *  - live-гард: на самому репо `.cursor/rules/n-*.mdc` == inlined-канон (дрейфу нема).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../utils/test-helpers.mjs'
import { findMirrorDrift, listManagedMirrors } from '../mirror-parity.mjs'
import { readNRulesConfigLite } from '../read-n-rules-config-lite.mjs'
import { getUnavailableDeclaredPlugins } from '../resolve-plugins.mjs'

/**
 * Готує tmp-репо, де `.n-rules.json` декларує плагін, якого немає в `node_modules` (і немає
 * жодного файлового сигналу автодетекту) — той самий стан, що й свіжий worktree без
 * `bun install`: канон дзеркала `id` мав би бути в цьому плагіні, але резолвер його не бачить.
 * @param {string} dir корінь tmp
 * @param {string} id id дзеркала, чий канон «живе» у незарезолвленому плагіні
 * @param {string} [pluginName] npm-ім'я задекларованого-але-не встановленого плагіна
 * @returns {Promise<void>}
 */
async function seedUnresolvedPlugin(dir, id, pluginName = '@acme/rules-plugin-fake') {
  await mkdir(join(dir, '.cursor/rules'), { recursive: true })
  await writeFile(join(dir, '.cursor/rules', `n-${id}.mdc`), `# rule ${id}\n`)
  await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ plugins: [pluginName] }))
}

/** Корінь репо від цього тесту: tests → lib → scripts → npm → <root>. */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')

/**
 * Готує tmp-репо з одним керованим дзеркалом і його каноном.
 * @param {string} dir корінь tmp
 * @param {string} canonical вміст канону
 * @param {string} mirror вміст дзеркала
 * @returns {Promise<void>}
 */
async function seed(dir, canonical, mirror) {
  await mkdir(join(dir, '.cursor/rules'), { recursive: true })
  await mkdir(join(dir, 'npm/rules/x'), { recursive: true })
  await writeFile(join(dir, 'npm/rules/x/main.mdc'), canonical)
  await writeFile(join(dir, '.cursor/rules/n-x.mdc'), mirror)
}

describe('findMirrorDrift', () => {
  test('mirror == канон (без шаблонів) → без дрейфу', async () => {
    await withTmpDir(async dir => {
      await seed(dir, '# rule x\nтіло\n', '# rule x\nтіло\n')
      expect(await findMirrorDrift(dir)).toEqual([])
    })
  })
  test('mirror ≠ канон → дрейф [x]', async () => {
    await withTmpDir(async dir => {
      await seed(dir, '# rule x\nновий рядок\n', '# rule x\nстарий рядок\n')
      expect(await findMirrorDrift(dir)).toEqual(['x'])
    })
  })
  test('дзеркало без канону пропускається (не дрейф)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.cursor/rules'), { recursive: true })
      await writeFile(join(dir, '.cursor/rules/n-external.mdc'), 'external\n')
      expect(await listManagedMirrors(dir)).toEqual([])
      expect(await findMirrorDrift(dir)).toEqual([])
    })
  })
  test('канон мав би бути в задекларованому, але незарезолвленому плагіні → гучна помилка, не []', async () => {
    await withTmpDir(async dir => {
      await seedUnresolvedPlugin(dir, 'y', '@acme/rules-plugin-fake')
      // Не []: мовчазне звуження обсягу до нуля видавало б це за «дрейфу нема».
      await expect(findMirrorDrift(dir)).rejects.toThrow(/@acme\/rules-plugin-fake/)
      await expect(findMirrorDrift(dir)).rejects.toThrow(/y/)
    })
  })
  test('listManagedMirrors позначає незарезолвлене дзеркало unresolved, не «зовнішнє»', async () => {
    await withTmpDir(async dir => {
      await seedUnresolvedPlugin(dir, 'y', '@acme/rules-plugin-fake')
      const mirrors = await listManagedMirrors(dir)
      expect(mirrors).toHaveLength(1)
      expect(mirrors[0]).toMatchObject({ id: 'y', canonicalPath: '', unresolved: true })
      expect(mirrors[0].missingPlugins).toContain('@acme/rules-plugin-fake')
    })
  })
  test('частина дзеркал резолвиться, частина ні → дрейф резолвлених не приховується в помилці', async () => {
    await withTmpDir(async dir => {
      // 'x' — канон у ядрі (npm/rules/x), резолвиться завжди; 'y' — мав би бути в
      // незарезолвленому плагіні. Дрейф 'x' має лишитись видимим у повідомленні помилки,
      // а не загубитись за тим, що 'y' не резолвиться.
      await seed(dir, '# rule x\nновий рядок\n', '# rule x\nстарий рядок\n')
      await seedUnresolvedPlugin(dir, 'y', '@acme/rules-plugin-fake')
      await expect(findMirrorDrift(dir)).rejects.toThrow(/x/)
    })
  })
})

describe('live parity (цей репо)', () => {
  test('усі задекларовані плагіни встановлені (інакше drift-гард порівнює не з тим каноном)', async () => {
    const config = await readNRulesConfigLite(REPO_ROOT)
    expect(getUnavailableDeclaredPlugins(REPO_ROOT, config)).toEqual([])
  })
  test('.cursor/rules/n-*.mdc == inlined-канон (нема дрейфу)', async () => {
    expect(await findMirrorDrift(REPO_ROOT)).toEqual([])
  })
})
