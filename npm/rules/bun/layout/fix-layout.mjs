/**
 * T0-autofix паттерни для `bun/layout` — детерміновані FS-виправлення
 * заборонених файлів (package-lock.json, yarn.lock тощо), відсутнього bunfig.toml
 * та каталогу .yarn без звернення до LLM.
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Імена заборонених файлів читаються з `v.message`, не з агрегованого output-рядка.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FORBIDDEN_FILE_RE = /Знайдено заборонений файл: \S+/u
const FORBIDDEN_FILE_NAME_RE = /Знайдено заборонений файл: (\S+)/u
const BUNFIG_MISSING_RE = /Відсутній bunfig\.toml/u
const YARN_DIR_RE = /Знайдено директорію \.yarn/u

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'rm-forbidden-file',
    test: violations => violations.some(v => FORBIDDEN_FILE_RE.test(v.message)),
    apply: (violations, ctx) => {
      const cwd = ctx.cwd
      const touchedFiles = []
      for (const v of violations) {
        const m = FORBIDDEN_FILE_NAME_RE.exec(v.message)
        if (!m) continue
        const filePath = join(cwd, m[1])
        if (existsSync(filePath)) {
          ctx.recordWrite?.(filePath)
          rmSync(filePath, { force: true })
          touchedFiles.push(filePath)
        }
      }
      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `видалено: ${touchedFiles.join(', ')}` }
    }
  },

  {
    id: 'bun-bunfig-create',
    test: violations => violations.some(v => BUNFIG_MISSING_RE.test(v.message)),
    apply: (_violations, ctx) => {
      const target = join(ctx.cwd, 'bunfig.toml')
      if (existsSync(target)) return { touchedFiles: [] }
      ctx.recordWrite?.(target)
      writeFileSync(target, '[install]\nlinker = "hoisted"\n', 'utf8')
      return { touchedFiles: [target], message: 'створено bunfig.toml' }
    }
  },

  {
    id: 'bun-yarn-dir-remove',
    test: violations => violations.some(v => YARN_DIR_RE.test(v.message)),
    apply: (_violations, ctx) => {
      const target = join(ctx.cwd, '.yarn')
      if (!existsSync(target)) return { touchedFiles: [] }
      ctx.recordWrite?.(target)
      rmSync(target, { recursive: true, force: true })
      return { touchedFiles: [target], message: 'видалено .yarn/' }
    }
  }
]
