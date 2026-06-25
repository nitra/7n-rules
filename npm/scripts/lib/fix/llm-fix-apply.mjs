/**
 * Спільне ядро LLM-фіксу: парс відповіді `{changes:[{path,content}]}`, читання файлів
 * під фікс і застосування змін. Використовують і `llm-worker.mjs` (конформність), і
 * `llm-lint-fix.mjs` (per-tool лінтер-фіксери) — щоб не дублювати парс/apply (knip/jscpd).
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const JSON_CODE_BLOCK_RE = /```(?:json)?[ \t]{0,8}\n?([\s\S]*?)```/

/**
 * Парсить JSON-відповідь моделі: прямий JSON → ```json-блок``` → перший `{…}`-блок.
 * @param {string} text сирий текст відповіді
 * @returns {{ changes?: Array<{path:string,content:string}>, error?: string } | null} патч або null
 */
export function parseChangesResponse(text) {
  try {
    return JSON.parse(text)
  } catch {
    /* fallthrough */
  }
  const block = text.match(JSON_CODE_BLOCK_RE)
  if (block) {
    try {
      return JSON.parse(block[1].trim())
    } catch {
      /* fallthrough */
    }
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      /* fallthrough */
    }
  }
  return null
}

/**
 * Шукає файл за basename у дереві проєкту (fallback коли прямий шлях не існує).
 * Повертає відносний шлях якщо знайдено рівно один матч, інакше `null` (ambiguous/not found).
 * @param {string} name basename файлу
 * @param {string} projectRoot абсолютний корінь
 * @returns {string|null} відносний шлях або null
 */
function findByBasename(name, projectRoot) {
  try {
    const raw = execSync(
      `find . -maxdepth 7 -name '${name.replace(/'/g, "'\\''")}' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.worktrees/*'`,
      { cwd: projectRoot, encoding: 'utf8', timeout: 3000 }
    ).trim()
    const hits = raw.split('\n').filter(Boolean)
    return hits.length === 1 ? hits[0].replace(/^\.\//, '') : null
  } catch {
    return null
  }
}

/**
 * Читає існуючі файли за відносними шляхами у форму `{path, content}` (для prompt).
 * Якщо файл не знайдений за прямим шляхом — намагається знайти за basename через `find`.
 * Повертає resolved path (може відрізнятись від вхідного коли `find` знайшов реальне місце).
 * @param {string[]} filePaths відносні шляхи від кореня
 * @param {string} projectRoot абсолютний корінь
 * @returns {Array<{path:string, content:string}>} наявні файли з вмістом
 */
export function readFilesForFix(filePaths, projectRoot) {
  return filePaths
    .map(p => {
      let abs = join(projectRoot, p)
      let resolvedPath = p
      if (!existsSync(abs)) {
        const found = findByBasename(basename(p), projectRoot)
        if (found) {
          resolvedPath = found
          abs = join(projectRoot, found)
        }
      }
      if (!existsSync(abs)) return null
      try {
        return { path: resolvedPath, content: readFileSync(abs, 'utf8') }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/**
 * Застосовує `changes` до ФС (повний вміст файлу, не diff).
 * @param {Array<{path:string, content:string}>} changes зміни
 * @param {string} projectRoot абсолютний корінь
 * @returns {{ ok: boolean, error?: string }} статус
 */
export function applyChanges(changes, projectRoot) {
  for (const change of changes) {
    if (!change.path || typeof change.content !== 'string') continue
    try {
      const abs = join(projectRoot, change.path)
      // Створюємо батьківську теку перед записом: модель може запропонувати новий файл
      // у ще неіснуючому каталозі (напр. `<ws>/.changes/…`) — інакше writeFileSync ENOENT.
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, change.content, 'utf8')
    } catch (error) {
      return { ok: false, error: `write ${change.path}: ${error.message}` }
    }
  }
  return { ok: true }
}
