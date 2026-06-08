/**
 * DAG-сканер вузлів задач.
 *
 * Рекурсивно обходить tasks_dir, знаходить всі вузли (директорії з task.md),
 * читає їх залежності з task.md front-matter, деривує стани та виконує
 * топологічне сортування (Kahn's algorithm).
 *
 * FS ін'єктується. Нічого не пише на диск.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseFrontMatter } from './frontmatter.mjs'
import { deriveNodeState, isComposite } from './node-state.mjs'

/**
 * @typedef {{
 *   id: string,
 *   path: string,
 *   dir: string,
 *   deps: string[],
 *   state: string,
 *   composite: boolean,
 *   children: string[]
 * }} NodeInfo
 */

/**
 * Рекурсивно знаходить всі вузли DAG у tasks_dir.
 * Вузол = директорія що містить task.md.
 * @param {string} tasksDir абсолютний шлях до tasks/
 * @param {{
 *   readdirSync?: (d: string) => string[],
 *   existsSync?: (p: string) => boolean,
 *   readFileSync?: (p: string, enc: string) => string
 * }} [deps] ін'єкції
 * @returns {{ dir: string, relPath: string }[]} список знайдених вузлів
 */
export function findNodes(tasksDir, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync
  const exists = deps.existsSync ?? existsSync

  const nodes = []

  function scan(dir, prefix = '') {
    let entries
    try {
      entries = readdir(dir)
    } catch {
      return
    }

    const hasTaskMd = entries.includes('task.md')
    if (hasTaskMd) {
      nodes.push({
        dir,
        relPath: prefix ? prefix : dir.split('/').pop() ?? dir
      })
    }

    // Рекурсивно шукаємо дочірні директорії
    for (const name of entries) {
      // Пропускаємо зарезервовані та приховані директорії/файли
      if (name.startsWith('.') || name.includes('.')) continue
      const childDir = join(dir, name)
      // Перевіряємо що це директорія (якщо має subdirs або task.md)
      const childRelPath = prefix ? `${prefix}/${name}` : name
      try {
        // Перевірка що childDir — дійсно директорія
        readdir(childDir)
        scan(childDir, childRelPath)
      } catch {
        // не директорія або не читається
      }
    }
  }

  scan(tasksDir)
  return nodes
}

/**
 * Сканує DAG і повертає всі вузли з деривованими станами.
 * @param {string} tasksDir абсолютний шлях до tasks/
 * @param {Set<string>} activeWorktrees активні worktree imена
 * @param {{
 *   readdirSync?: (d: string) => string[],
 *   existsSync?: (p: string) => boolean,
 *   readFileSync?: (p: string, enc: string) => string
 * }} [deps] ін'єкції
 * @returns {NodeInfo[]} список вузлів
 */
export function scanNodes(tasksDir, activeWorktrees, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync
  const exists = deps.existsSync ?? existsSync
  const readFile = deps.readFileSync ?? ((p, enc) => readFileSync(p, enc))

  const found = findNodes(tasksDir, { readdirSync: readdir, existsSync: exists, readFileSync: readFile })

  return found.map(({ dir, relPath }) => {
    let fm = {}
    try {
      const taskContent = readFile(join(dir, 'task.md'), 'utf8')
      fm = parseFrontMatter(taskContent)
    } catch {
      // порожній front-matter
    }

    const deps_ = Array.isArray(fm.deps) ? fm.deps.map(String) : []
    const state = deriveNodeState(dir, activeWorktrees, { readdirSync: readdir, readFileSync: readFile, existsSync: exists })
    const composite = isComposite(dir, { readdirSync: readdir, existsSync: exists })

    // Дочірні вузли
    let children = []
    if (composite) {
      let entries
      try {
        entries = readdir(dir)
      } catch {
        entries = []
      }
      children = entries
        .filter(name => !name.startsWith('.') && !name.endsWith('.md') && !name.endsWith('.json'))
        .filter(name => {
          try {
            return exists(join(dir, name, 'task.md'))
          } catch {
            return false
          }
        })
        .map(name => `${relPath}/${name}`)
    }

    return {
      id: relPath,
      path: relPath,
      dir,
      deps: deps_,
      state,
      composite,
      children
    }
  })
}

/**
 * Топологічне сортування вузлів (алгоритм Кана).
 * Вузли без залежностей — першими. Циклічні залежності — не гарантовано.
 * @param {NodeInfo[]} nodes вузли зі списком deps
 * @returns {NodeInfo[]} відсортований список (або той самий порядок якщо циклічні)
 */
export function topoSort(nodes) {
  const idToNode = new Map(nodes.map(n => [n.id, n]))
  const inDegree = new Map(nodes.map(n => [n.id, 0]))
  const adj = new Map(nodes.map(n => [n.id, []]))

  for (const node of nodes) {
    for (const dep of node.deps) {
      if (idToNode.has(dep)) {
        adj.get(dep).push(node.id)
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1)
      }
    }
  }

  const queue = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0).map(n => n.id)
  const sorted = []

  while (queue.length > 0) {
    const id = queue.shift()
    const node = idToNode.get(id)
    if (node) sorted.push(node)
    for (const next of (adj.get(id) ?? [])) {
      const deg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  // Якщо є цикли — додаємо решту у кінець
  if (sorted.length < nodes.length) {
    for (const n of nodes) {
      if (!sorted.includes(n)) sorted.push(n)
    }
  }

  return sorted
}

/**
 * Перевіряє чи всі залежності вузла resolved.
 * @param {NodeInfo} node вузол
 * @param {Map<string, NodeInfo>} nodeMap map id -> NodeInfo
 * @returns {boolean} true якщо всі deps resolved
 */
export function areDepsResolved(node, nodeMap) {
  return node.deps.every(dep => {
    const depNode = nodeMap.get(dep)
    return depNode?.state === 'resolved'
  })
}

/**
 * Знаходить активні worktrees з git worktree list.
 * @param {string} root корінь репо
 * @param {{ execSync?: (cmd: string, opts?: object) => string }} [deps] ін'єкції
 * @returns {Set<string>} set імен worktree
 */
export function getActiveWorktrees(root, deps = {}) {
  const execSyncFn = deps.execSync ?? ((cmd, opts) => execSync(cmd, opts))
  try {
    const out = execSyncFn('git worktree list --porcelain', { cwd: root, encoding: 'utf8' })
    return parseWorktreeList(String(out))
  } catch {
    return new Set()
  }
}

/**
 * Парсить вивід `git worktree list --porcelain` і повертає набір імен worktree.
 * @param {string} output вивід команди
 * @returns {Set<string>} set імен (останній компонент шляху)
 */
export function parseWorktreeList(output) {
  const names = new Set()
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      const path = line.slice('worktree '.length).trim()
      const name = path.split('/').pop() ?? ''
      if (name) names.add(name)
    }
  }
  return names
}
