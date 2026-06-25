/**
 * Discovery T0-autofix паттернів з rule-level `fix-*.mjs` файлів.
 *
 * Сканує `npm/rules/{rule}/js/fix-*.mjs` і `npm/rules/{rule}/policy/{concern}/fix-*.mjs`
 * по всіх правилах, динамічно імпортує кожен і збирає масиви `patterns`.
 * `t0.mjs` ініціалізує результат через top-level await (один раз при завантаженні модуля).
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @typedef {{ id: string, test: (output: string) => boolean, apply: (output: string, cwd: string) => Promise<{ok: boolean, action: string}> | {ok: boolean, action: string} }} T0Pattern
 */

/**
 * Повертає абсолютні шляхи до `fix-*.mjs` файлів у директорії (плоско, без рекурсії).
 * @param {string} dir абсолютний шлях до директорії
 * @returns {Promise<string[]>}
 */
async function findFixFiles(dir) {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name.startsWith('fix-') && e.name.endsWith('.mjs'))
    .map(e => join(dir, e.name))
}

/**
 * Повертає абсолютні шляхи до `policy/{concern}/fix-*.mjs` у правилі.
 * @param {string} policyDir абсолютний шлях `rules/{rule}/policy/`
 * @returns {Promise<string[]>}
 */
async function findPolicyFixFiles(policyDir) {
  if (!existsSync(policyDir)) return []
  const entries = await readdir(policyDir, { withFileTypes: true })
  const paths = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    paths.push(...(await findFixFiles(join(policyDir, entry.name))))
  }
  return paths
}

/**
 * Збирає всі T0-паттерни з `fix-*.mjs` файлів усіх правил у `rulesDir`.
 * @param {string} rulesDir абсолютний шлях до `npm/rules/`
 * @returns {Promise<T0Pattern[]>} об'єднаний масив паттернів
 */
export async function discoverT0Patterns(rulesDir) {
  if (!existsSync(rulesDir)) return []
  const ruleEntries = await readdir(rulesDir, { withFileTypes: true })
  /** @type {T0Pattern[]} */
  const allPatterns = []

  for (const ruleEntry of ruleEntries) {
    if (!ruleEntry.isDirectory() || ruleEntry.name.startsWith('.')) continue
    const ruleDir = join(rulesDir, ruleEntry.name)

    const fixPaths = [
      ...(await findFixFiles(join(ruleDir, 'js'))),
      ...(await findPolicyFixFiles(join(ruleDir, 'policy')))
    ]

    for (const fixPath of fixPaths) {
      try {
        const mod = await import(fixPath)
        if (Array.isArray(mod.patterns)) allPatterns.push(...mod.patterns)
      } catch (err) {
        console.error(`[discover-t0-patterns] не вдалося імпортувати ${fixPath}: ${err.message}`)
      }
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
