/** @see ./docs/main.md */
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/** Іменований імпорт з `@nitra/tfm` — захоплює список імен усередині `{ ... }`. */
const TFM_IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]@nitra\/tfm['"]/

/** Один запис іменованого імпорту `tf` (з опційним `as <alias>`). */
const TF_SPECIFIER_RE = /^tf(?:\s+as\s+\w+)?$/

/** Оголошення функції `getTr` — `function getTr(...)` або `const/let getTr = (...)`. */
const GET_TR_DECL_RE = /(?:function\s+getTr\s*\(|(?:const|let|var)\s+getTr\s*=)/

/**
 * Чи імпортує вміст файлу `tf` (можливо з `as <alias>`) саме з `@nitra/tfm`.
 * @param {string} content вихідний текст файлу
 * @returns {boolean} `true`, якщо знайдено іменований імпорт `tf` з `@nitra/tfm`
 */
function importsTfFromTfm(content) {
  const m = TFM_IMPORT_RE.exec(content)
  if (!m) return false
  return m[1].split(',').some(entry => TF_SPECIFIER_RE.test(entry.trim()))
}

/**
 * Detector concern-а `tfm-translations`: якщо `.vue`-файл імпортує `tf` з `@nitra/tfm`,
 * у цьому ж файлі має бути оголошена функція `getTr()` з перекладами (vue.mdc tfm-translations).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту (`ctx.files` — delta-файли).
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат з порушеннями.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter

  if (ctx.files === undefined || ctx.files.length === 0) return reporter.result()

  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { existsSync } = await import('node:fs')

  for (const file of ctx.files) {
    if (!file.endsWith('.vue')) continue
    const absPath = join(ctx.cwd, file)
    if (!existsSync(absPath)) continue
    const content = await readFile(absPath, 'utf8')
    if (!importsTfFromTfm(content)) continue
    if (GET_TR_DECL_RE.test(content)) continue
    fail(
      `${file}: імпортує 'tf' з '@nitra/tfm', але не оголошує функцію getTr() з перекладами ` +
        `(vue.mdc tfm-translations)`,
      { file }
    )
  }

  return reporter.result()
}
