/**
 * T0-autofix для policy-concern-а `js-run/jsconfig`: merge-запис `jsconfig.json` з
 * канонічними значеннями (`template/jsconfig.json.snippet.json`, той самий `data.template.snippet`,
 * що бачить rego). Leaf-рівень `compilerOptions` перезаписується точним канонічним значенням
 * (rego вимагає exact match, не subset), top-level масиви (`include`) — теж exact set.
 * Локальні поля поза каноном (інші секції compilerOptions, коментарі-джерела) — зберігаються.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Читає JSON-файл template-сніпета концерну; відсутній/невалідний → null.
 * @param {string} path абсолютний шлях
 * @returns {object|null} розпарсений об'єкт або null
 */
function readSnippet(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {unknown} a значення
 * @param {unknown} b значення
 * @returns {boolean} чи однакові як множини (масиви) або строго (інше)
 */
function valuesMatch(a, b) {
  if (Array.isArray(b)) {
    return Array.isArray(a) && new Set(a).size === new Set(b).size && b.every(x => a.includes(x))
  }
  return a === b
}

/**
 * Мерджить канонічну секцію (`compilerOptions`) у `cfg[field]`: кожен leaf перезаписується
 * канонічним значенням, якщо відрізняється.
 * @param {object} cfg поточний jsconfig
 * @param {string} field назва секції
 * @param {object} expectedSection канонічні leaf-значення секції
 * @returns {string[]} список змінених шляхів (`field.leaf`)
 */
function mergeSection(cfg, field, expectedSection) {
  const changes = []
  const inner = typeof cfg[field] === 'object' && cfg[field] !== null ? cfg[field] : {}
  cfg[field] = inner
  for (const [leaf, leafExpected] of Object.entries(expectedSection)) {
    if (valuesMatch(inner[leaf], leafExpected)) continue
    inner[leaf] = leafExpected
    changes.push(`${field}.${leaf}`)
  }
  return changes
}

/**
 * Мерджить канонічний snippet у `jsconfig.json`: leaf-рівень (`compilerOptions.*`) і
 * top-level масиви перезаписуються канонічним значенням, якщо відрізняються.
 * @param {object} cfg поточний jsconfig
 * @param {object} snippet канонічний snippet
 * @returns {string[]} список змінених шляхів (для message)
 */
function mergeSnippet(cfg, snippet) {
  const changes = []
  for (const [field, expected] of Object.entries(snippet)) {
    if (Array.isArray(expected)) {
      if (!valuesMatch(cfg[field], expected)) {
        cfg[field] = expected
        changes.push(field)
      }
      continue
    }
    if (typeof expected === 'object' && expected !== null) {
      changes.push(...mergeSection(cfg, field, expected))
      continue
    }
    if (cfg[field] !== expected) {
      cfg[field] = expected
      changes.push(field)
    }
  }
  return changes
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'jsconfig-merge-canon',
    test: violations => violations.some(v => v.reason === 'policy-deny' && v.file),
    apply: (violations, ctx) => {
      const snippet = readSnippet(join(ctx.concernDir ?? '', 'template', 'jsconfig.json.snippet.json'))
      if (!snippet) return { touchedFiles: [] }

      const files = [...new Set(violations.filter(v => v.file).map(v => v.file))]
      const touchedFiles = []
      const messages = []

      for (const rel of files) {
        const abs = join(ctx.cwd, rel)
        let cfg
        try {
          cfg = JSON.parse(readFileSync(abs, 'utf8'))
        } catch {
          continue
        }
        const changes = mergeSnippet(cfg, snippet)
        if (changes.length === 0) continue

        ctx.recordWrite?.(abs)
        writeFileSync(abs, `${JSON.stringify(cfg, null, 2)}\n`)
        touchedFiles.push(abs)
        messages.push(`${rel}: ${changes.join(', ')}`)
      }

      return touchedFiles.length > 0 ? { touchedFiles, message: messages.join('; ') } : { touchedFiles: [] }
    }
  }
]
