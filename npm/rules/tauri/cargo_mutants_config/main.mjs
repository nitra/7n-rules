/**
 * @see ./docs/cargo_mutants_config.md
 *
 * Read-only detector: лише ЗВІТУЄ про відсутній чи неповний
 * `<ws>/src-tauri/.cargo/mutants.toml` (відсутні канонічні Tauri-ключі).
 * Створення/augment baseline — окремий T0-fix (`fix-cargo_mutants_config.mjs`),
 * не в detector-і (`lint --no-fix` ніколи не мутує дерево). Спільні білдери
 * baseline/append-блоку експортуємо для T0.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
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

/**
 * Read-only: звітує стан одного `src-tauri/` каталогу — файла немає
 * (`mutants-config-missing`) або бракує канонічних ключів (`mutants-keys-missing`).
 * @param {string} srcTauriDir абсолютний шлях до `src-tauri/`
 * @param {string} cwd корінь проєкту (для relative-шляхів у репортах)
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>}
 */
async function reportOneSrcTauri(srcTauriDir, cwd, reporter) {
  const target = join(srcTauriDir, '.cargo', 'mutants.toml')
  const rel = relative(cwd, target)

  if (!existsSync(target)) {
    reporter.fail(
      `.cargo/mutants.toml відсутній (${rel}) — запусти \`npx @7n/rules lint tauri\` для Tauri canonical baseline (tauri.mdc)`,
      { reason: MUTANTS_CONFIG_MISSING, file: rel }
    )
    return
  }

  const missing = await detectMissingKeys(target)
  if (missing.length === 0) {
    reporter.pass(`.cargo/mutants.toml: manual cargo-mutants config preserved (${rel})`)
    return
  }

  reporter.fail(
    `.cargo/mutants.toml: бракує канонічних Tauri-ключів [${missing.join(', ')}] (${rel}) — запусти \`npx @7n/rules lint tauri\` (tauri.mdc)`,
    { reason: MUTANTS_KEYS_MISSING, file: rel, data: { missing } }
  )
}

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки `.cargo/mutants.toml`.
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const srcTauriDirs = await findSrcTauriDirs(cwd)
  if (srcTauriDirs.length === 0) {
    return reporter.result()
  }
  for (const dir of srcTauriDirs) {
    await reportOneSrcTauri(dir, cwd, reporter)
  }
  return reporter.result()
}
