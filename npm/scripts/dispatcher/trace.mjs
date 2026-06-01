/**
 * `n-cursor trace` (spec §5.4/§7) — наскрізна простежуваність: читає front-matter
 * артефактів у `docs/{tasks,specs,plans,adr}`, будує ланцюг за лінками
 * (`adr`/`spec`/`plan`/`change`/`task`) і **флагує розриви** (лінк на неіснуючий
 * файл). Read-only. `--json` для machine-readable.
 *
 * FS-доступ (`readdir`/`readFile`/`exists`) ін'єктується — тестується без диска.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

/** Поля-лінки у front-matter, що утворюють ланцюг. */
const LINK_FIELDS = ['adr', 'spec', 'plan', 'flow', 'change', 'task']

/** Каталоги з traceable-артефактами. */
const DIRS = ['docs/tasks', 'docs/specs', 'docs/plans', 'docs/adr']

/**
 * Парсить плаский YAML-front-matter (key: value). Не обробляє вкладеність —
 * достатньо для spec/plan/task-record полів. Інлайн-коментарі (` #…`) відрізає.
 * @param {string} content вміст файла
 * @returns {Record<string, string | null> | null} мапа полів або null, якщо немає front-matter
 */
export function parseFrontMatter(content) {
  if (!content.startsWith('---')) return null
  const end = content.indexOf('\n---', 3)
  if (end === -1) return null
  const fm = {}
  for (const line of content.slice(3, end).split('\n')) {
    const ci = line.indexOf(':')
    if (ci === -1) continue
    const key = line.slice(0, ci).trim()
    if (!isSimpleKey(key)) continue
    let val = line.slice(ci + 1)
    const hi = val.indexOf(' #')
    if (hi !== -1) val = val.slice(0, hi)
    val = val.trim().replace(/^["']/u, '').replace(/["']$/u, '')
    fm[key] = val === '' || val === 'null' ? null : val
  }
  return fm
}

/**
 * Чи `key` — простий ідентифікатор (літери/підкреслення).
 * @param {string} key ключ
 * @returns {boolean} true для простого ключа
 */
function isSimpleKey(key) {
  return key.length > 0 && [...key].every(c => /[a-z_]/iu.test(c))
}

/**
 * Будує аналіз: для кожного артефакту — його лінки зі статусом ok/розрив.
 * @param {{ file: string, fm: Record<string, string | null> }[]} artifacts артефакти з front-matter
 * @param {(target: string) => boolean} exists чи існує цільовий файл лінка
 * @returns {{ file: string, kind: string | null, id: string | null, status: string | null, links: { field: string, target: string, ok: boolean }[] }[]} аналіз
 */
export function analyze(artifacts, exists) {
  return artifacts.map(({ file, fm }) => ({
    file,
    kind: fm.kind ?? null,
    id: fm.id ?? null,
    status: fm.status ?? null,
    links: LINK_FIELDS.filter(f => fm[f]).map(f => ({ field: f, target: fm[f], ok: exists(fm[f]) }))
  }))
}

/**
 * Текстовий рендер аналізу.
 * @param {object[]} analysis результат `analyze`
 * @returns {string} людино-читабельний вивід
 */
export function render(analysis) {
  if (analysis.length === 0) return 'trace: артефактів із front-matter не знайдено'
  const lines = []
  for (const a of analysis) {
    lines.push(`${a.kind ?? '?'} · ${a.id ?? a.file} [${a.status ?? '—'}]`)
    for (const l of a.links) {
      const mark = l.ok ? '→' : '✗'
      const note = l.ok ? '' : ' (РОЗРИВ — файл відсутній)'
      lines.push(`   ${mark} ${l.field}: ${l.target}${note}`)
    }
  }
  return lines.join('\n')
}

/**
 * CLI `n-cursor trace [--json]`. Повертає 1, якщо є розриви ланцюга.
 * @param {string[]} args аргументи
 * @param {{ cwd?: string, readdir?: (dir: string) => string[], readFile?: (file: string) => string, exists?: (file: string) => boolean, log?: (m: string) => void }} [deps] ін'єкції
 * @returns {number} exit code (0 — цілісно, 1 — є розриви)
 */
export function runTraceCli(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const readdir = deps.readdir ?? (dir => (existsSync(dir) ? readdirSync(dir) : []))
  const readFile = deps.readFile ?? (file => readFileSync(file, 'utf8'))
  const exists = deps.exists ?? (file => existsSync(file))
  const log = deps.log ?? console.log

  const artifacts = []
  for (const dir of DIRS) {
    for (const name of readdir(join(root, dir))) {
      if (!name.endsWith('.md')) continue
      const rel = `${dir}/${name}`
      const fm = parseFrontMatter(readFile(join(root, rel)))
      if (fm && (fm.id || fm.kind)) artifacts.push({ file: rel, fm })
    }
  }

  const analysis = analyze(artifacts, target => exists(join(root, target)))
  log(args.includes('--json') ? JSON.stringify(analysis, null, 2) : render(analysis))
  return analysis.some(a => a.links.some(l => !l.ok)) ? 1 : 0
}
