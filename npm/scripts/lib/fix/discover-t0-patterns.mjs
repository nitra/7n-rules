/**
 * Discovery T0-autofix паттернів з concern-level `fix-*.mjs` файлів.
 *
 * Сканує glob `{rule}/{concern}/fix-*.mjs` у `npm/rules/`, залишає лише файли де поряд є `concern.json`,
 * динамічно імпортує кожен і збирає масиви `patterns`.
 * `t0.mjs` ініціалізує результат через top-level await (один раз при завантаженні модуля).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { globby } from 'globby'

/**
 * @typedef {{ id: string, test: (output: string) => boolean, apply: (output: string, cwd: string) => Promise<{ok: boolean, action: string}> | {ok: boolean, action: string} }} T0Pattern
 */

/**
 * Збирає всі T0-паттерни з `fix-*.mjs` файлів усіх правил у `rulesDir`.
 * @param {string} rulesDir абсолютний шлях до `npm/rules/`
 * @returns {Promise<T0Pattern[]>} об'єднаний масив паттернів
 */
export async function discoverT0Patterns(rulesDir) {
  if (!existsSync(rulesDir)) return []

  // Scan fix-*.mjs у concern dirs (підкаталогах із concern.json)
  const allCandidates = await globby(['*/*/fix-*.mjs'], {
    cwd: rulesDir,
    onlyFiles: true,
    gitignore: false
  })
  const { existsSync: fsExistsSync } = await import('node:fs')
  const relPaths = allCandidates.filter(p => {
    const parts = p.split('/')
    if (parts.length < 2) return false
    return fsExistsSync(join(rulesDir, parts[0], parts[1], 'concern.json'))
  })

  /** @type {T0Pattern[]} */
  const allPatterns = []
  for (const rel of relPaths) {
    const fixPath = join(rulesDir, rel)
    try {
      const mod = await import(fixPath)
      if (Array.isArray(mod.patterns)) allPatterns.push(...mod.patterns)
    } catch (err) {
      console.error(`[discover-t0-patterns] не вдалося імпортувати ${fixPath}: ${err.message}`)
    }
  }

  // Дедуплікація за id: shared утиліти (напр. vscode-ext-add) re-export'яться з ≥2 правил
  // і потрапляють у список кілька разів — залишаємо перше входження.
  const seen = new Set()
  return allPatterns.filter(p => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
}
