/**
 * Тести layout-детекції stories-глоба (`detectStoriesGlob`, `main.mjs`) і
 * стабільності шаблонів `template/`. Фікстури — динамічні тимчасові дерева
 * (mkdtemp), не статичні файли в репо (авто-fix лінтера цього репозиторію
 * переписав би "погані" зразки, якби вони лежали як звичайні файли під деревом
 * правила).
 *
 * §2.93: T0-autofix цього концерну більше НЕ має JS-канону — `fix_storybook_scaffold`
 * у `crates/plugin-lang-js` єдиний виконавець, і його покриття живе там
 * (`fix_storybook_scaffold_*`, сім тестів) плюс повний T0-цикл у
 * `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs`. Десять
 * тестів `fix-scaffold: T0 autofix …` цього файлу знято разом із каноном.
 * Шаблони `template/` при цьому лишились ДЖЕРЕЛОМ (гість вшиває їх
 * `include_str!`-ом, adopt-режим рендерить із них через `../render.mjs`) —
 * тому регресійні перевірки шаблонів нижче не осиротіли, а стали важливішими.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { detectStoriesGlob } from '../main.mjs'

const CONCERN_DIR = join(import.meta.dirname, '..')

/**
 * @param {string} root абсолютний шлях
 * @param {string} rel відносний шлях файлу
 * @param {string} content вміст
 */
async function writeFileDeep(root, rel, content) {
  const abs = join(root, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

describe('detectStoriesGlob', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-scaffold-glob-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('src/components/ присутній — звужений glob', async () => {
    await writeFileDeep(root, 'src/components/Comp.vue', '<template/>')
    expect(detectStoriesGlob(root)).toBe('../src/components/**/*.stories.@(js|ts)')
  })

  test('пласка структура (src/ без components/) — ширший glob', async () => {
    await writeFileDeep(root, 'src/Comp.vue', '<template/>')
    expect(detectStoriesGlob(root)).toBe('../src/**/*.stories.@(js|ts)')
  })

  test('flat-root: .vue-файли прямо в корені пакета (без src/) — flat-root glob', async () => {
    await writeFileDeep(root, 'NDialog.vue', '<template/>')
    expect(detectStoriesGlob(root)).toBe('../*.stories.@(js|ts)')
  })

  test('flat-root має пріоритет над src/components/, якщо корінь теж містить .vue', async () => {
    await writeFileDeep(root, 'NDialog.vue', '<template/>')
    await writeFileDeep(root, 'src/components/Comp.vue', '<template/>')
    expect(detectStoriesGlob(root)).toBe('../*.stories.@(js|ts)')
  })

  test('немає жодного .vue у корені — flat-root не спрацьовує (fallback на src/components)', async () => {
    await writeFileDeep(root, 'src/components/Comp.vue', '<template/>')
    await writeFileDeep(root, 'README.md', '# not vue')
    expect(detectStoriesGlob(root)).toBe('../src/components/**/*.stories.@(js|ts)')
  })
})

/**
 * Регресійні тести-без-lint для шаблонів `.storybook/` (детектор-lint видалено — покриття
 * перенесено в `crates/plugin-lang-js` `#[cfg(test)]`, `detect_storybook_scaffold_*`):
 * самі шаблони мають лишатись стабільними, бо гість (`fix_storybook_scaffold`) вшиває
 * їх `include_str!`-ом і записує verbatim, а marker-набори (`MAIN_JS_MARKERS` тощо)
 * звірені байт-у-байт у Rust.
 */
describe('шаблони app-скафолду хвилі 2a (дзеркальна асиметрія з бібліотекою)', () => {
  test('app-main.js без viteConfigPath-обходу (свідома асиметрія з бібліотекою)', async () => {
    const mainTemplate = await readFile(join(CONCERN_DIR, 'template/app-main.js'), 'utf8')
    // Функціональний маркер обходу — core.builder.options, не сам підрядок "viteConfigPath"
    // (він згадується в коментарі шаблону як пояснення, ЧОМУ обходу немає).
    expect(mainTemplate).not.toContain('core: {')
  })

  test('app-main.js НЕ знімає vite-plugin-pages (регрес фіксу пілота gt — знімати його ламає storybook build)', async () => {
    const mainTemplate = await readFile(join(CONCERN_DIR, 'template/app-main.js'), 'utf8')
    expect(mainTemplate).not.toContain("'vite-plugin-pages'")
    // Справжні layout/router-генератори лишаються під фільтром.
    expect(mainTemplate).toContain("'unplugin-vue-router'")
    expect(mainTemplate).toContain("'vite-plugin-vue-layouts'")
    expect(mainTemplate).toContain("'vite-plugin-vue-layouts-next'")
  })
})

