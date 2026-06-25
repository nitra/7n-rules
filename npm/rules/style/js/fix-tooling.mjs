/**
 * T0-autofix паттерни для `style/js/tooling.mjs` — детерміновані FS-виправлення:
 * створення або доповнення `.stylelintignore` та додавання `stylelint` до `package.json`.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** @type {import('../../../scripts/lib/fix/discover-t0-patterns.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'style-stylelintignore-create',
    test: out => /\.stylelintignore не існує/.test(out),
    apply: (_out, cwd) => {
      writeFileSync(join(cwd, '.stylelintignore'), 'dist/\n', 'utf8')
      return { ok: true, action: 'створено .stylelintignore' }
    }
  },

  {
    id: 'style-stylelintignore-dist-add',
    test: out => /\.stylelintignore не містить рядка dist\//.test(out),
    apply: (_out, cwd) => {
      appendFileSync(join(cwd, '.stylelintignore'), '\ndist/\n', 'utf8')
      return { ok: true, action: 'додано dist/ до .stylelintignore' }
    }
  },

  {
    id: 'style-pkg-stylelint-add',
    test: out => /Немає конфігу stylelint/.test(out),
    apply: (_out, cwd) => {
      const pkgPath = join(cwd, 'package.json')
      if (!existsSync(pkgPath)) return { ok: false, action: 'package.json не знайдено' }
      let pkg
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      } catch {
        return { ok: false, action: 'package.json: невалідний JSON' }
      }
      if (pkg.stylelint) return { ok: false, action: 'stylelint вже є в package.json' }
      pkg.stylelint = { extends: '@nitra/stylelint-config' }
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
      return { ok: true, action: 'додано stylelint до package.json' }
    }
  }
]
