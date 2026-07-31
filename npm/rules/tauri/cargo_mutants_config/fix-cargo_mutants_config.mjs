/**
 * T0-autofix для `tauri/cargo_mutants_config` — детерміноване створення або
 * без-дублювання augment `<ws>/src-tauri/.cargo/mutants.toml` канонічними
 * Tauri-ключами.
 *
 * Константи й білдери baseline/append-блоку дубльовані з native-порту
 * detector-а (`crates/rules-core/src/concerns/tauri_cargo_mutants_config.rs`),
 * а не імпортуються з `main.mjs` — detector портований у Rust (G1 фази 5
 * батчу 3, TOML-кластер), а `main.mjs` видалений (G2). T0-фіксер лишається
 * JS (запис у файлову систему поза native-поверхнею). Матчинг по
 * `violation.data` тут недоцільний (як у `tauri/gitignore_target`): apply()
 * не читає per-violation дані, а повторно сканує `src-tauri/`-каталоги від
 * `ctx.cwd` і стан кожного файла наново — той самий підхід, що й до порту
 * detector-а в Rust, поведінка не змінена.
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Цільові каталоги резолвимо повторним скануванням src-tauri від `ctx.cwd`;
 * стан кожного перевіряємо наново (idempotent — already-complete пропускаємо).
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

/** Стабільний reason: файл mutants-конфігу відсутній узагалі. */
export const MUTANTS_CONFIG_MISSING = 'mutants-config-missing'
/** Стабільний reason: mutants-конфіг є, але бракує канонічних Tauri-ключів. */
export const MUTANTS_KEYS_MISSING = 'mutants-keys-missing'

/** Шапка-коментар канонічного mutants-конфігу Tauri: пояснює, навіщо виключені збірки бінарника й doc-тестів. */
export const TAURI_BASELINE_HEADER = `# .cargo/mutants.toml — Tauri canonical cargo-mutants config (tauri.mdc).
# Виключаємо --bins і --doc щоб бінарник Tauri та doc-tests не збиралися повторно
# з нуля під кожного мутанта (секунди → хвилини).
`

/** Канонічні TOML-фрагменти по ключах mutants-конфігу — T0-fix дописує відсутній ключ саме цим текстом. */
export const TAURI_KEY_SNIPPETS = Object.freeze({
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

/** Перелік канонічних ключів, наявність яких перевіряється у mutants-конфігу Tauri-застосунку. */
export const TAURI_CANONICAL_KEYS = Object.freeze(Object.keys(TAURI_KEY_SNIPPETS))

/**
 * Знаходить усі `<ws>/src-tauri/` каталоги з власним `Cargo.toml` у монорепо.
 * Обходить workspace-пакети через `getMonorepoPackageRootDirs` (корінь + усі workspaces).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи до знайдених `src-tauri/` каталогів
 */
export async function findSrcTauriDirs(cwd) {
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
export async function detectMissingKeys(targetPath) {
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
export function buildAppended(existing, missingKeys) {
  const tail = existing.endsWith('\n') ? existing : `${existing}\n`
  const block = ['\n# Tauri canonical cargo-mutants additions (tauri.mdc)\n']
  for (const key of missingKeys) block.push(TAURI_KEY_SNIPPETS[key])
  return tail + block.join('')
}

/**
 * Будує повний Tauri-canonical baseline (для випадку, коли файла ще немає).
 * @returns {string} вміст для нового `.cargo/mutants.toml`
 */
export function buildBaseline() {
  return TAURI_BASELINE_HEADER + TAURI_CANONICAL_KEYS.map(k => TAURI_KEY_SNIPPETS[k]).join('\n')
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'tauri-cargo-mutants-config-create',
    test: violations => violations.some(v => v.reason === MUTANTS_CONFIG_MISSING || v.reason === MUTANTS_KEYS_MISSING),
    apply: async (violations, ctx) => {
      const cwd = ctx.cwd
      const srcTauriDirs = await findSrcTauriDirs(cwd)
      const touchedFiles = []
      for (const srcTauriDir of srcTauriDirs) {
        const target = join(srcTauriDir, '.cargo', 'mutants.toml')
        if (!existsSync(target)) {
          ctx.recordWrite?.(target)
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, buildBaseline())
          touchedFiles.push(target)
          continue
        }
        const missing = await detectMissingKeys(target)
        if (missing.length === 0) continue
        ctx.recordWrite?.(target)
        const existing = await readFile(target, 'utf8')
        await writeFile(target, buildAppended(existing, missing))
        touchedFiles.push(target)
      }
      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `створено/доповнено Tauri .cargo/mutants.toml: ${touchedFiles.join(', ')}` }
    }
  }
]
