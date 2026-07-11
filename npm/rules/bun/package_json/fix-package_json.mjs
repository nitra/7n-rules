/**
 * T0-autofix для policy-concern-а `bun/package_json`: видаляє заборонені top-level поля
 * (канон — `template/package.json.deny.json`, той самий `data.template.deny`, що бачить rego)
 * і `scripts.lint` / `scripts.lint-*` (bun.mdc — лінт лише через `n-cursor lint`, не npm-скрипти).
 *
 * Деструктивний, але недвозначний фікс: rego явно ЗАБОРОНЯЄ ці ключі, тож видалення —
 * не вгадування значення (на відміну від `devDependencies`-allowlist чи version-полів,
 * які цей fixer НЕ чіпає — там потрібне людське рішення).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LINT_SCRIPT_RE = /^lint(-.*)?$/u

/**
 * Читає JSON-файл template-а з deny-полями концерну; відсутній/невалідний → {}.
 * @param {string} path абсолютний шлях
 * @returns {Record<string, string>} мапа `field -> reason`
 */
function readDenyTemplate(path) {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Видаляє заборонені top-level поля й `scripts.lint*` з `package.json`.
 * @param {object} pkg розпарсений package.json
 * @param {Record<string, string>} denyFields канон заборонених top-level полів
 * @returns {string[]} список видалених ключів (для message)
 */
function stripDenied(pkg, denyFields) {
  const removed = []
  for (const field of Object.keys(denyFields)) {
    if (!Object.hasOwn(pkg, field)) continue
    delete pkg[field]
    removed.push(field)
  }
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const name of Object.keys(pkg.scripts)) {
      if (!LINT_SCRIPT_RE.test(name)) continue
      delete pkg.scripts[name]
      removed.push(`scripts.${name}`)
    }
  }
  return removed
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'bun-package_json-strip-denied',
    test: violations => violations.some(v => v.reason === 'policy-deny' && v.file),
    apply: (violations, ctx) => {
      const denyFields = readDenyTemplate(join(ctx.concernDir ?? '', 'template', 'package.json.deny.json'))
      const files = [...new Set(violations.filter(v => v.file).map(v => v.file))]
      const touchedFiles = []
      const messages = []

      for (const rel of files) {
        const abs = join(ctx.cwd, rel)
        let pkg
        try {
          pkg = JSON.parse(readFileSync(abs, 'utf8'))
        } catch {
          continue
        }
        const removed = stripDenied(pkg, denyFields)
        if (removed.length === 0) continue

        ctx.recordWrite?.(abs)
        writeFileSync(abs, `${JSON.stringify(pkg, null, 2)}\n`)
        touchedFiles.push(abs)
        messages.push(`${rel}: -${removed.join(', -')}`)
      }

      return touchedFiles.length > 0 ? { touchedFiles, message: messages.join('; ') } : { touchedFiles: [] }
    }
  }
]
