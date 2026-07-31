/** @see ./docs/fix-linux_deps.md */

/**
 * T0-autofix для `tauri/linux_deps` — детерміновано вставляє в
 * `.github/workflows/lint-rust.yml` канонічний крок системних залежностей Linux
 * перед `dtolnay/rust-toolchain@…`, або дописує відсутні пакети в уже наявний
 * `apt-get install`-рядок. Текстові splice-и (як `rust/toolchain_cache`) —
 * зберігають коментарі/формат, мінімальний diff. Ідемпотентно: `scanLinuxDeps`
 * заново перевіряє стан файла на кожному прогоні.
 *
 * Константи й `scanLinuxDeps` дубльовані з native-порту detector-а
 * (`crates/rules-core/src/concerns/tauri_linux_deps.rs`), не імпортуються з
 * видаленого `main.mjs` — на відміну від `tauri/gitignore_target`, цей фіксер
 * НЕ читає `violation.data.missing` напряму: `insertLinuxDepsStep` і
 * `appendMissingPackages` обидва потребують позиції apt-рядка в поточному
 * вмісті файла (індекс рядка не входить у `violation.data`), тож усе одно
 * повторно сканують файл через `scanLinuxDeps` — той самий підхід, що й до
 * порту detector-а в Rust (задокументовано в doc-комент native-модуля),
 * поведінка не змінена.
 */
import { applyToFiles } from '../../../scripts/utils/apply-to-files.mjs'

/** Стабільний reason: у CI-workflow немає apt-кроку встановлення Linux-залежностей Tauri. */
const MISSING_LINUX_DEPS_STEP = 'missing-linux-deps-step'
/** Стабільний reason: apt-крок є, але в ньому бракує канонічних пакетів. */
const MISSING_LINUX_DEPS_PACKAGES = 'missing-linux-deps-packages'

/**
 * Канонічні dev-пакети для компіляції Tauri v2 на ubuntu-runner-і:
 * webkit2gtk-4.1 (WebView), ayatana-appindicator (tray), rsvg (іконки).
 * Перевірка — підмножина: додаткові пакети в apt-рядку дозволені.
 */
const REQUIRED_LINUX_PACKAGES = Object.freeze(['libwebkit2gtk-4.1-dev', 'libayatana-appindicator3-dev', 'librsvg2-dev'])

const APT_INSTALL_RE = /\bapt-get install\b/u

/**
 * Результат текстового сканування lint-rust.yml на apt-крок системних залежностей.
 * @typedef {object} LinuxDepsScan
 * @property {number} aptLine індекс першого рядка з `apt-get install` (−1, якщо немає)
 * @property {string[]} missing канонічні пакети, відсутні у вмісті файла
 */

/**
 * Сканує вміст workflow: перший `apt-get install`-рядок і перелік канонічних
 * пакетів, яких немає ніде у файлі (substring — пакет може стояти на
 * continuation-рядку багаторядкового `run: |`).
 * @param {string} content вміст workflow-файла
 * @returns {LinuxDepsScan} результат сканування
 */
function scanLinuxDeps(content) {
  const lines = content.split('\n')
  const aptLine = lines.findIndex(l => APT_INSTALL_RE.test(l))
  const missing = REQUIRED_LINUX_PACKAGES.filter(p => !content.includes(p))
  return { aptLine, missing }
}

const TOOLCHAIN_RE = /uses:\s*dtolnay\/rust-toolchain@/u

/**
 * Вставляє канонічний apt-крок перед першим `dtolnay/rust-toolchain@…` кроком
 * (той самий рівень step-list-а). Якщо apt-крок уже є або toolchain-кроку немає
 * (нетипове форматування — лишаємо T1/LLM), нічого не змінює.
 * @param {string} content вміст workflow-файла
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function insertLinuxDepsStep(content) {
  if (scanLinuxDeps(content).aptLine !== -1) return null
  const lines = content.split('\n')
  const at = lines.findIndex(l => TOOLCHAIN_RE.test(l))
  if (at === -1) return null
  const usesCol = lines[at].indexOf('uses:')
  const ind = ' '.repeat(Math.max(usesCol - 2, 0))
  lines.splice(
    at,
    0,
    `${ind}- name: Системні залежності Tauri (Linux)`,
    `${ind}  run: |`,
    `${ind}    sudo apt-get update`,
    `${ind}    sudo apt-get install -y ${REQUIRED_LINUX_PACKAGES.join(' ')}`,
    ''
  )
  return lines.join('\n')
}

/**
 * Дописує відсутні канонічні пакети в кінець наявного `apt-get install`-рядка
 * (з урахуванням trailing `\` shell-continuation).
 * @param {string} content вміст workflow-файла
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function appendMissingPackages(content) {
  const { aptLine, missing } = scanLinuxDeps(content)
  if (aptLine === -1 || missing.length === 0) return null
  const lines = content.split('\n')
  const trimmed = lines[aptLine].trimEnd()
  lines[aptLine] = trimmed.endsWith('\\')
    ? `${trimmed.slice(0, -1).trimEnd()} ${missing.join(' ')} \\`
    : `${trimmed} ${missing.join(' ')}`
  return lines.join('\n')
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'tauri-linux-deps-insert',
    test: violations => violations.some(v => v.data?.kind === MISSING_LINUX_DEPS_STEP && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === MISSING_LINUX_DEPS_STEP && v.file)
      const touchedFiles = applyToFiles(targets, ctx, () => insertLinuxDepsStep)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `apt-крок системних залежностей Tauri → ${touchedFiles.length} workflow(s)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'tauri-linux-deps-packages',
    test: violations => violations.some(v => v.data?.kind === MISSING_LINUX_DEPS_PACKAGES && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === MISSING_LINUX_DEPS_PACKAGES && v.file)
      const touchedFiles = applyToFiles(targets, ctx, () => appendMissingPackages)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `канонічні Tauri-пакети → ${touchedFiles.length} workflow(s)` }
        : { touchedFiles: [] }
    }
  }
]
