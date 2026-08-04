/**
 * Гейт синхронності `KNOWN_PLUGIN_RANGES` із версіями first-party плагінів
 * у цьому ж воркспейсі (`plugins/<name>/package.json`).
 *
 * Навіщо окремо від `release-smoke.mjs`: та звірка ходить у registry і тому
 * спрацьовує лише ПІСЛЯ публікації — тобто про дрейф дізнаєшся, коли `main`
 * уже червоний (реальний випадок 2026-08-04: `@7n/rules-lang-js` виїхав на
 * 0.26.0 при range `^0.25`). Плагіни живуть у цьому ж репо, тож розбіжність
 * видно локально ще на PR — цей гейт ловить її до релізу, а не після.
 *
 * Таблиця ручна за задумом (доккоментар `KNOWN_PLUGIN_RANGES`): вона обмежує
 * авто-інсталяцію сумісною лінією. Тому тест не «виправляє» range, а вимагає
 * підняти його свідомо разом із minor-версією плагіна.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { env } from 'node:process'

import { describe, expect, test } from 'vitest'

import { KNOWN_PLUGIN_RANGES } from '../resolve-plugins.mjs'

/** Провідний caret у range (`^0.26` → `0.26`). */
const CARET_PREFIX_RE = /^\^/

const HERE = dirname(fileURLToPath(import.meta.url))
/** npm/scripts/lib/tests → up 4. */
const REPO_ROOT = join(HERE, '..', '..', '..', '..')

/**
 * Версії first-party плагінів воркспейсу за іменем пакета.
 * @returns {Map<string, string>} name → version
 */
function workspacePluginVersions() {
  const dirs = ['ci-azure', 'ci-github', 'lang-js', 'lang-php', 'lang-python', 'lang-rust']
  const out = new Map()
  for (const d of dirs) {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'plugins', d, 'package.json'), 'utf8'))
    out.set(pkg.name, pkg.version)
  }
  return out
}

/**
 * Чи влучає версія у caret-range таблиці. Для `0.x` caret фіксує minor
 * (`^0.26` приймає 0.26.z, але не 0.27.0), для `>=1` — major (`^2` приймає 2.y.z).
 * @param {string} version версія пакета (`0.26.0`)
 * @param {string} range range з таблиці (`^0.26` / `^2`)
 * @returns {boolean} true — влучає
 */
function satisfiesCaret(version, range) {
  const parts = range.replace(CARET_PREFIX_RE, '').split('.')
  const v = version.split('.')
  if (parts[0] === '0') return v[0] === '0' && v[1] === parts[1]
  return v[0] === parts[0]
}

describe('KNOWN_PLUGIN_RANGES ⇄ версії плагінів воркспейсу', () => {
  const versions = workspacePluginVersions()

  test.skipIf(env.STRYKER_MUTATOR_WORKER)('кожен плагін воркспейсу присутній у таблиці', () => {
    for (const name of versions.keys()) {
      expect(KNOWN_PLUGIN_RANGES[name], `${name} немає в KNOWN_PLUGIN_RANGES`).toBeDefined()
    }
  })

  test.skipIf(env.STRYKER_MUTATOR_WORKER).each(Array.from(versions, ([name, version]) => ({ name, version })))(
    'range для $name влучає у локальну версію $version',
    ({ name, version }) => {
      const range = KNOWN_PLUGIN_RANGES[name]
      expect(
        satisfiesCaret(version, range),
        `${name}@${version} не влучає у ${range} — підніми range у resolve-plugins.mjs разом із новою версією плагіна`
      ).toBe(true)
    }
  )
})
