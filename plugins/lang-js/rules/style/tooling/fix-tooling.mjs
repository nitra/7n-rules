/**
 * T0-autofix паттерни для `style/tooling` — детерміновані FS-виправлення:
 * створення або доповнення `.stylelintignore` та додавання `stylelint` до `package.json`.
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Тип порушення визначається за `v.message`, не за агрегованим output-рядком.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLELINTIGNORE_MISSING_RE = /\.stylelintignore не існує/u
const STYLELINTIGNORE_NO_DIST_RE = /\.stylelintignore не містить рядка dist\//u
const NO_STYLELINT_CONFIG_RE = /Немає конфігу stylelint/u

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'style-stylelintignore-create',
    test: violations => violations.some(v => STYLELINTIGNORE_MISSING_RE.test(v.message)),
    apply: (_violations, ctx) => {
      const target = join(ctx.cwd, '.stylelintignore')
      ctx.recordWrite?.(target)
      writeFileSync(target, 'dist/\n', 'utf8')
      return { touchedFiles: [target], message: 'створено .stylelintignore' }
    }
  },

  {
    id: 'style-stylelintignore-dist-add',
    test: violations => violations.some(v => STYLELINTIGNORE_NO_DIST_RE.test(v.message)),
    apply: (_violations, ctx) => {
      const target = join(ctx.cwd, '.stylelintignore')
      ctx.recordWrite?.(target)
      appendFileSync(target, '\ndist/\n', 'utf8')
      return { touchedFiles: [target], message: 'додано dist/ до .stylelintignore' }
    }
  },

  {
    id: 'style-pkg-stylelint-add',
    test: violations => violations.some(v => NO_STYLELINT_CONFIG_RE.test(v.message)),
    apply: (_violations, ctx) => {
      const pkgPath = join(ctx.cwd, 'package.json')
      if (!existsSync(pkgPath)) return { touchedFiles: [] }
      let pkg
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      } catch {
        return { touchedFiles: [] }
      }
      if (pkg.stylelint) return { touchedFiles: [] }
      ctx.recordWrite?.(pkgPath)
      pkg.stylelint = { extends: '@nitra/stylelint-config' }
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
      return { touchedFiles: [pkgPath], message: 'додано stylelint до package.json' }
    }
  }
]
