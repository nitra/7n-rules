/**
 * T0-autofix для concern-а `storybook/ci` (ADR Кластер 5, CI-частина): відтворює канонічний
 * composite action `setup-playwright-chromium` (кеш Playwright-браузерів, лише chromium) і
 * канонічний `.github/workflows/lint-storybook.yml` з `template/` цього concern-а.
 *
 * Обидва файли — репо-рівневі (не per-package): composite action — verbatim-копія; workflow —
 * матриця `strategy.matrix.package` генерується з фактичного списку пакетів у скоупі
 * (`collectInScopeVuePackages`), щоб CI реально покривав усі Storybook-пакети репозиторію.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

import { collectInScopeVuePackages } from '../storybook-scope/main.mjs'

/** Каталог `template/` цього concern-а. */
export const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'template')

/** Токен у `lint-storybook.yml.snippet.yml`, що заміщається списком пакетів матриці. */
const PACKAGE_DIRS_TOKEN = '__STORYBOOK_CI_PACKAGE_DIRS__'

/**
 * Вміст канонічного composite action `setup-playwright-chromium` — verbatim з template.
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {Promise<string>} вміст `action.yml`
 */
export function renderPlaywrightAction(templateDir = TEMPLATE_DIR) {
  return readFile(join(templateDir, 'setup-playwright-chromium.action.yml'), 'utf8')
}

/**
 * Рендерить YAML-фрагмент `matrix.package` списку — по одному `- <rootDir>` на рядок, з тим
 * самим відступом, що й токен-рядок у шаблоні (10 пробілів — рівень елемента списку під
 * `strategy.matrix.package:`). `rootDir === '.'` (корінь монорепо) лишається `.` — валідний
 * `working-directory` для GitHub Actions.
 * @param {string[]} rootDirs відносні (posix) корені пакетів у скоупі
 * @returns {string} YAML-рядки (без завершального переносу)
 */
export function renderPackageDirsYaml(rootDirs) {
  return rootDirs.map(dir => `          - ${dir}`).join('\n')
}

/**
 * Вміст канонічного `.github/workflows/lint-storybook.yml` — template з підставленою
 * матрицею пакетів у скоупі.
 * @param {string[]} rootDirs відносні корені пакетів у скоупі (`collectInScopeVuePackages`)
 * @param {string} [templateDir] каталог template/ (за замовчуванням — цього concern-а)
 * @returns {Promise<string>} вміст `lint-storybook.yml`
 */
export async function renderStorybookWorkflow(rootDirs, templateDir = TEMPLATE_DIR) {
  const raw = await readFile(join(templateDir, 'lint-storybook.yml.snippet.yml'), 'utf8')
  const tokenLineRe = new RegExp(`^[ \\t]*${PACKAGE_DIRS_TOKEN}[ \\t]*$`, 'mu')
  // Replacer-функція (не рядок) — уникає unicorn/no-unsafe-string-replacement:
  // рядок-заміна мав би трактувати `$`-послідовності як спецсимволи `String#replace`.
  return raw.replace(tokenLineRe, () => renderPackageDirsYaml(rootDirs))
}

/**
 * Записує файл, створюючи батьківські каталоги й реєструючи запис для rollback (той самий
 * патерн, що й `writeScaffoldFile` у `scaffold/fix-scaffold.mjs`).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} ctx fix-контекст рунга
 * @param {string} absPath абсолютний шлях цільового файлу
 * @param {string} content вміст файлу
 * @returns {void}
 */
function writeCiFile(ctx, absPath, content) {
  mkdirSync(dirname(absPath), { recursive: true })
  ctx.recordWrite?.(absPath)
  writeFileSync(absPath, content, 'utf8')
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'storybook-ci-playwright-action',
    test: violations => violations.some(v => v.reason === 'missing-playwright-action' && v.file),
    apply: async (violations, ctx) => {
      const target = violations.find(v => v.reason === 'missing-playwright-action' && v.file)
      if (!target || !ctx.concernDir) return { touchedFiles: [] }

      const content = await renderPlaywrightAction(join(ctx.concernDir, 'template'))
      const abs = join(ctx.cwd, target.file)
      writeCiFile(ctx, abs, content)
      return { touchedFiles: [abs], message: `${target.file}: створено composite action setup-playwright-chromium` }
    }
  },
  {
    id: 'storybook-ci-workflow',
    test: violations => violations.some(v => v.reason === 'missing-storybook-workflow' && v.file),
    apply: async (violations, ctx) => {
      const target = violations.find(v => v.reason === 'missing-storybook-workflow' && v.file)
      if (!target || !ctx.concernDir) return { touchedFiles: [] }

      const pkgs = await collectInScopeVuePackages(ctx.cwd)
      const rootDirs = pkgs.map(p => p.rootDir)
      if (rootDirs.length === 0) return { touchedFiles: [] }

      const content = await renderStorybookWorkflow(rootDirs, join(ctx.concernDir, 'template'))
      const abs = join(ctx.cwd, target.file)
      writeCiFile(ctx, abs, content)
      return { touchedFiles: [abs], message: `${target.file}: створено (${rootDirs.length} пакет(ів) у матриці)` }
    }
  }
]
