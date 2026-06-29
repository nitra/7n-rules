/**
 * T0-autofix паттерни для `bun/js/layout.mjs` — детерміновані FS-виправлення
 * заборонених файлів (package-lock.json, yarn.lock тощо), відсутнього bunfig.toml
 * та каталогу .yarn без звернення до LLM.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FORBIDDEN_FILE_RE = /Знайдено заборонений файл: \S+/
const FORBIDDEN_FILE_MATCH_ALL_RE = /Знайдено заборонений файл: (\S+)/g

/** @type {import('../../../scripts/lib/fix/discover-t0-patterns.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'rm-forbidden-file',
    test: out => FORBIDDEN_FILE_RE.test(out),
    apply: (out, cwd) => {
      const matches = [...out.matchAll(FORBIDDEN_FILE_MATCH_ALL_RE)]
      if (matches.length === 0) return { ok: false, action: 'no match' }

      const removed = []
      for (const m of matches) {
        const filePath = join(cwd, m[1])
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true })
          removed.push(m[1])
        }
      }
      if (removed.length === 0) return { ok: false, action: 'файлів не знайдено' }
      return { ok: true, action: `видалено: ${removed.join(', ')}` }
    }
  },

  {
    id: 'bun-bunfig-create',
    test: out => /Відсутній bunfig\.toml/.test(out),
    apply: (_out, cwd) => {
      const target = join(cwd, 'bunfig.toml')
      if (existsSync(target)) return { ok: false, action: 'bunfig.toml вже існує' }
      writeFileSync(target, '[install]\nlinker = "hoisted"\n', 'utf8')
      return { ok: true, action: 'створено bunfig.toml' }
    }
  },

  {
    id: 'bun-yarn-dir-remove',
    test: out => /Знайдено директорію \.yarn/.test(out),
    apply: (_out, cwd) => {
      const target = join(cwd, '.yarn')
      if (!existsSync(target)) return { ok: false, action: '.yarn не знайдено' }
      rmSync(target, { recursive: true, force: true })
      return { ok: true, action: 'видалено .yarn/' }
    }
  }
]
