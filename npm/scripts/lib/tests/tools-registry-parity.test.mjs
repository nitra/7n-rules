import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { TOOLS } from '../ensure-tool.mjs'
import { resolveRulesCliBin } from '../../utils/test-helpers.mjs'

/**
 * Крос-мовний гейт ЄДИНОГО ДЖЕРЕЛА ПРАВДИ про зовнішні CLI-тули (мінідизайн
 * `docs/specs/2026-08-04-tools-ensure-design.md`, розділ 3).
 *
 * Реєстр живе в `npm/scripts/lib/tools.json`: JS будує з нього `TOOLS`
 * (`ensure-tool.mjs`), Rust вбудовує той самий файл на збірці
 * (`rules_core::tool_registry`). Файл один, тож розійтися можуть не ДАНІ, а
 * їх ІНТЕРПРЕТАЦІЯ — розгортання шаблонів `{ver}`/`{arch}` і мапінг
 * архітектури (`mapArch` ⇄ `map_arch`). Саме це тут і звіряється: вивід
 * `rules-cli tools list --json` проти обчисленого JS-боком на ТІЙ САМІЙ
 * машині.
 *
 * Спеціально порівнюються `asset`, `binPath` і `downloadUrl` уже РОЗГОРНУТІ
 * на закріпленій версії: розбіжність у мапінгу архітектури дає 404 на
 * завантаженні, який інакше вилізе лише на ефемерному CI-раннері чужого репо.
 */

/** Піни версій — те саме джерело, що читають обидві мови. */
const PINS = JSON.parse(readFileSync(fileURLToPath(new URL('../tool-pins.json', import.meta.url)), 'utf8'))

/**
 * Запускає `rules-cli tools list --json` і повертає розібраний вивід.
 * @returns {{ tools: object[] }} машинний інвентар тулів
 */
function nativeToolsList() {
  const result = spawnSync(resolveRulesCliBin(), ['tools', 'list', '--json'], {
    encoding: 'utf8',
    env: { ...env }
  })
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

/** Маршрут установки — brew, scoop або GitHub Release. */
const INSTALL_ROUTE_RE = /brew install|scoop install|github\.com/u

describe('tools registry: JS ⇄ Rust', () => {
  test('склад реєстру збігається', () => {
    const native = nativeToolsList().tools.map(t => t.id)
    expect(native.toSorted()).toEqual(Object.keys(TOOLS).toSorted())
  })

  test('поля запису й розгорнуті шаблони збігаються для кожного тула', () => {
    for (const tool of nativeToolsList().tools) {
      const js = TOOLS[tool.id]
      expect(js, `тула ${tool.id} немає в JS-реєстрі`).toBeDefined()
      expect(tool.entry.brew, tool.id).toBe(js.brew)
      expect(tool.entry.scoop, tool.id).toBe(js.scoop)
      expect(tool.entry.github, tool.id).toBe(js.github)
      expect(tool.entry.archStyle, tool.id).toBe(js.archStyle)
      expect(tool.entry.archive, tool.id).toBe(js.archive)
      expect(tool.entry.tagPrefix, tool.id).toBe(js.tagPrefix)

      const ver = PINS.versions[tool.id]
      expect(tool.version, tool.id).toBe(ver)
      expect(tool.rendered.asset, tool.id).toBe(js.asset(ver))
      expect(tool.rendered.binPath, tool.id).toBe(js.binFinder === null ? null : js.binFinder(ver))
    }
  })

  test('маршрут встановлення не порожній і згадує спосіб для цієї ОС', () => {
    for (const tool of nativeToolsList().tools) {
      expect(tool.route, tool.id).toMatch(INSTALL_ROUTE_RE)
    }
  })
})
