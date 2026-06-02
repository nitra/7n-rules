/**
 * `n-cursor graph` — read-only позиція DAG вузлів (контракт
 * `docs/specs/2026-06-01-node-dag-state.md`). Перший зріз: `status` —
 * сканує `docs/graphs/<g>/nodes/*.md`, групує файли по вузлах, деривує статус
 * (done/failed/awaiting-human/in_progress/ready/blocked) і друкує таблицю.
 *
 * Стан — у файлах; нічого не мутує. FS (`readdir`/`readFile`/`exists`)
 * ін'єктується — тестується без диска. claim/tick/dispatch — наступні зрізи.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { parseFrontMatter } from './trace.mjs'

/** Суфікси-артефакти вузла без qid. */
const PLAIN = [
  ['.plan', 'plan'],
  ['.claim', 'claim'],
  ['.fact', 'fact']
]
/** Префікси-артефакти з qid (`.ask-<qid>`, `.ans-<qid>`). */
const QID = [
  ['.ask-', 'ask'],
  ['.ans-', 'ans']
]

/**
 * Класифікує файл-артефакт вузла за назвою.
 * @param {string} name назва файлу (напр. `B02-parser.ask-q1.md`)
 * @returns {{ stem: string, kind: string, qid?: string } | null} класифікація або null
 */
export function classifyArtifact(name) {
  if (!name.endsWith('.md')) return null
  const base = name.slice(0, -'.md'.length)
  for (const [suffix, kind] of PLAIN) {
    if (base.endsWith(suffix)) return { stem: base.slice(0, -suffix.length), kind }
  }
  for (const [prefix, kind] of QID) {
    const i = base.lastIndexOf(prefix)
    if (i !== -1) return { stem: base.slice(0, i), kind, qid: base.slice(i + prefix.length) }
  }
  return null
}

/**
 * Парсить inline-список `[A, B]` із front-matter у масив id.
 * @param {string | null | undefined} value значення поля
 * @returns {string[]} елементи (trim, без порожніх)
 */
export function parseIdList(value) {
  if (typeof value !== 'string') return []
  return value
    .replace('[', '')
    .replace(']', '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Сканує вузли графа: групує файли по stem, читає plan/fact front-matter.
 * @param {string} root корінь репо
 * @param {string} graph id графа (каталог `docs/graphs/<graph>`)
 * @param {{ readdir?: (dir: string) => string[], readFile?: (file: string) => string }} [deps] ін'єкції FS
 * @returns {{ id: string, slug: string, dependsOn: string[], owner: string | null, hasClaim: boolean, hasFact: boolean, factStatus: string | null, asks: string[], answered: string[] }[]} вузли
 */
export function scanGraph(root, graph, deps = {}) {
  const readdir = deps.readdir ?? (dir => (existsSync(dir) ? readdirSync(dir) : []))
  const readFile = deps.readFile ?? (file => readFileSync(file, 'utf8'))
  const dir = join(root, 'docs', 'graphs', graph, 'nodes')

  const byStem = new Map()
  const ensure = stem => {
    if (!byStem.has(stem)) {
      byStem.set(stem, {
        stem,
        id: stem.split('-')[0],
        slug: stem.slice(stem.indexOf('-') + 1),
        dependsOn: [],
        owner: null,
        hasClaim: false,
        hasFact: false,
        factStatus: null,
        asks: [],
        answered: []
      })
    }
    return byStem.get(stem)
  }

  for (const name of readdir(dir)) {
    const art = classifyArtifact(name)
    if (!art) continue
    const node = ensure(art.stem)
    switch (art.kind) {
      case 'plan': {
        const fm = parseFrontMatter(readFile(join(dir, name))) ?? {}
        node.id = fm.id ?? node.id
        node.dependsOn = parseIdList(fm.dependsOn)
        node.owner = fm.owner ?? null
        break
      }
      case 'claim': {
        node.hasClaim = true
        break
      }
      case 'fact': {
        const fm = parseFrontMatter(readFile(join(dir, name))) ?? {}
        node.hasFact = true
        node.factStatus = fm.status ?? 'done'
        break
      }
      case 'ask': {
        node.asks.push(art.qid)
        break
      }
      case 'ans': {
        node.answered.push(art.qid)
        break
      }
      // no default
    }
  }
  return [...byStem.values()]
}

/**
 * Деривує статус одного вузла (чиста).
 * @param {{ hasFact: boolean, factStatus: string | null, hasClaim: boolean, asks: string[], answered: string[], dependsOn: string[] }} node вузол
 * @param {Set<string>} doneSet id вузлів зі статусом done
 * @returns {'done' | 'failed' | 'awaiting-human' | 'in_progress' | 'ready' | 'blocked'} статус
 */
export function deriveStatus(node, doneSet) {
  if (node.hasFact) return node.factStatus === 'failed' ? 'failed' : 'done'
  const openAsk = node.asks.some(q => !node.answered.includes(q))
  if (node.hasClaim && openAsk) return 'awaiting-human'
  if (node.hasClaim) return 'in_progress'
  if (node.dependsOn.every(d => doneSet.has(d))) return 'ready'
  return 'blocked'
}

/**
 * Деривує статуси всіх вузлів графа (спершу doneSet із fact done).
 * @param {object[]} nodes вузли зі `scanGraph`
 * @returns {object[]} вузли з полем `status`
 */
export function deriveGraph(nodes) {
  const doneSet = new Set(nodes.filter(n => n.hasFact && n.factStatus !== 'failed').map(n => n.id))
  return nodes.map(n => ({ ...n, status: deriveStatus(n, doneSet) }))
}

/**
 * Текстовий рендер позиції графа.
 * @param {string} graph id графа
 * @param {object[]} nodes вузли з полем `status`
 * @returns {string} людино-читабельна таблиця
 */
export function renderGraph(graph, nodes) {
  if (nodes.length === 0) return `граф ${graph}: вузлів не знайдено`
  const order = ['in_progress', 'awaiting-human', 'ready', 'blocked', 'failed', 'done']
  const counts = order
    .map(s => [s, nodes.filter(n => n.status === s).length])
    .filter(([, c]) => c > 0)
    .map(([s, c]) => `${s}:${c}`)
    .join(' ')
  const lines = [`граф ${graph} — ${counts}`]
  for (const n of nodes) {
    const owner = n.owner ? ` ${n.owner}` : ''
    const deps = n.dependsOn.length > 0 ? ` ←[${n.dependsOn.join(',')}]` : ''
    lines.push(`  ${n.id} · ${n.slug} [${n.status}]${owner}${deps}`)
  }
  return lines.join('\n')
}

/**
 * Перелік графів (каталоги в `docs/graphs/`).
 * @param {string} root корінь репо
 * @param {(dir: string) => string[]} readdir інжектована readdir
 * @returns {string[]} id графів
 */
function listGraphs(root, readdir) {
  return readdir(join(root, 'docs', 'graphs'))
}

/**
 * CLI `n-cursor graph <status> [graph]`. Read-only.
 * @param {string[]} args аргументи після `graph`
 * @param {{ cwd?: string, readdir?: (dir: string) => string[], readFile?: (file: string) => string, log?: (m: string) => void }} [deps] ін'єкції
 * @returns {number} exit code (0 ok, 1 невідома підкоманда)
 */
export function runGraphCli(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const readdir = deps.readdir ?? (dir => (existsSync(dir) ? readdirSync(dir) : []))
  const log = deps.log ?? console.log
  const [sub, graphArg] = args

  if (sub !== 'status') {
    log('Usage: n-cursor graph status [<graph>]')
    return 1
  }

  const graphs = graphArg ? [graphArg] : listGraphs(root, readdir)
  if (graphs.length === 0) {
    log('graph: у docs/graphs/ немає графів')
    return 0
  }
  for (const g of graphs) {
    log(renderGraph(g, deriveGraph(scanGraph(root, g, { readdir, readFile: deps.readFile }))))
  }
  return 0
}
