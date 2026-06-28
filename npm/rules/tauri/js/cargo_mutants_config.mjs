/** @see ./docs/cargo_mutants_config.md */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

const TAURI_BASELINE_HEADER = `# .cargo/mutants.toml — Tauri canonical cargo-mutants config (tauri.mdc).
# Виключаємо --bins і --doc щоб бінарник Tauri та doc-tests не збиралися повторно
# з нуля під кожного мутанта (секунди → хвилини).
`

const TAURI_KEY_SNIPPETS = Object.freeze({
  additional_cargo_test_args: 'additional_cargo_test_args = ["--lib", "--tests"]\n',
  exclude_globs: `# Platform bridge / app shell — boundary-файли (тестуються smoke/e2e, не mutation unit).
# Якщо у bridge-файлі з'являється pure/business logic — винеси її у platform-neutral
# модуль (src/auth/oauth.rs, src/gmail/message.rs, ...) і тестуй mutation-testing там.
# src/lib.rs (Tauri pub fn run) — runtime entrypoint, що запускає весь app shell:
# один мутант там тримає весь Tauri runtime, тому ділить sandbox-фейл з src/main.rs.
exclude_globs = [
  "src/main.rs",
  "src/lib.rs",
  "src/**/android.rs",
  "src/**/ios.rs",
  "src/**/mobile.rs",
  "src/**/desktop.rs",
  "src/**/macos.rs",
  "src/**/windows.rs",
  "src/**/linux.rs"
]
`
})

const TAURI_CANONICAL_KEYS = Object.freeze(Object.keys(TAURI_KEY_SNIPPETS))

/**
 * Знаходить усі `<ws>/src-tauri/` каталоги з власним `Cargo.toml` у монорепо.
 * Обходить workspace-пакети через `getMonorepoPackageRootDirs` (корінь + усі workspaces).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи до знайдених `src-tauri/` каталогів
 */
async function findSrcTauriDirs(cwd) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  const result = []
  for (const root of roots) {
    const srcTauriCargo = join(cwd, root, 'src-tauri', 'Cargo.toml')
    if (existsSync(srcTauriCargo)) {
      result.push(join(cwd, root, 'src-tauri'))
    }
  }
  return result
}

/**
 * Зчитує існуючий `.cargo/mutants.toml` і повертає top-level ключі, яких ще немає.
 * @param {string} targetPath абсолютний шлях до файла
 * @returns {Promise<string[]>} список відсутніх канонічних ключів (зі збереженням порядку TAURI_CANONICAL_KEYS)
 */
async function detectMissingKeys(targetPath) {
  const existing = await readFile(targetPath, 'utf8')
  const parsed = parseToml(existing)
  return TAURI_CANONICAL_KEYS.filter(k => !(k in parsed))
}

/**
 * Будує append-блок з відсутніх ключів. Існуючий вміст не торкається.
 * @param {string} existing поточний вміст файла
 * @param {string[]} missingKeys ключі, які треба додати
 * @returns {string} новий вміст файла
 */
function buildAppended(existing, missingKeys) {
  const tail = existing.endsWith('\n') ? existing : `${existing}\n`
  const block = ['\n# Tauri canonical cargo-mutants additions (tauri.mdc)\n']
  for (const key of missingKeys) block.push(TAURI_KEY_SNIPPETS[key])
  return tail + block.join('')
}

/**
 * Будує повний Tauri-canonical baseline (для випадку, коли файла ще немає).
 * @returns {string} вміст для нового `.cargo/mutants.toml`
 */
function buildBaseline() {
  return TAURI_BASELINE_HEADER + TAURI_CANONICAL_KEYS.map(k => TAURI_KEY_SNIPPETS[k]).join('\n')
}

/**
 * Обробляє один `src-tauri/` каталог: створює або без дублювання доповнює `.cargo/mutants.toml`.
 * @param {string} srcTauriDir абсолютний шлях до `src-tauri/`
 * @param {string} cwd корінь проєкту (для relative-шляхів у репортах)
 * @param {{ pass: (msg: string) => void, fail: (msg: string) => void }} reporter репортер концерну
 * @returns {Promise<void>}
 */
async function processOneSrcTauri(srcTauriDir, cwd, reporter) {
  const target = join(srcTauriDir, '.cargo', 'mutants.toml')
  const rel = relative(cwd, target)

  if (!existsSync(target)) {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, buildBaseline())
    reporter.pass(`.cargo/mutants.toml створено з Tauri canonical baseline (${rel}) (tauri.mdc)`)
    return
  }

  const missing = await detectMissingKeys(target)
  if (missing.length === 0) {
    reporter.pass(`.cargo/mutants.toml: manual cargo-mutants config preserved (${rel})`)
    return
  }

  const existing = await readFile(target, 'utf8')
  await writeFile(target, buildAppended(existing, missing))
  reporter.pass(`.cargo/mutants.toml: додано відсутні Tauri-ключі [${missing.join(', ')}] (${rel}) (tauri.mdc)`)
}

/**
 * @param {string} [cwd] корінь проєкту (default: `process.cwd()` — CLI-сумісність)
 * @returns {Promise<number>} 0 — OK або silently skipped, 1 — порушення
 */
export async function main(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const srcTauriDirs = await findSrcTauriDirs(cwd)
  if (srcTauriDirs.length === 0) {
    return reporter.getExitCode()
  }
  for (const dir of srcTauriDirs) {
    await processOneSrcTauri(dir, cwd, reporter)
  }
  return reporter.getExitCode()
}
