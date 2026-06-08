/**
 * Побудова DAG з файлової структури `tasks/`.
 * Читає task.md кожного вузла (один раз), будує граф в пам'яті.
 * Deps satisfaction вираховується пакетно — не per-node.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { parseFrontmatter } from './frontmatter.mjs'
import { deriveAtomicState, deriveCompositeState } from './state.mjs'

/**
 * @typedef {{
 *   id: string,
 *   path: string,
 *   parentId: string | null,
 *   deps: string[],
 *   mode: string,
 *   executor: { type: string, model_tier: string, skills: string[] },
 *   budget_sec: number,
 *   isComposite: boolean,
 *   children: string[],
 *   state: import('./state.mjs').NodeState,
 *   meta: Record<string, unknown>
 * }} GraphNode
 */

/**
 * Сканує tasks_dir і будує повний DAG.
 * @param {string} tasksDir абсолютний шлях
 * @param {string} [worktreesDir]
 * @returns {Map<string, GraphNode>}
 */
export function buildDag(tasksDir, worktreesDir = '') {
  /** @type {Map<string, GraphNode>} */
  const nodes = new Map()

  // 1. Collect all nodes
  collectNodes(tasksDir, tasksDir, null, nodes)

  // 2. Resolve parent-child relationships
  for (const node of nodes.values()) {
    if (node.parentId) {
      const parent = nodes.get(node.parentId)
      if (parent && !parent.children.includes(node.id)) {
        parent.children.push(node.id)
        parent.isComposite = true
      }
    }
  }

  // 3. Derive states (bottom-up)
  const resolvedIds = new Set()
  deriveStatesBottomUp(tasksDir, nodes, resolvedIds, worktreesDir)

  return nodes
}

/**
 * @param {string} dir поточна директорія
 * @param {string} tasksDir корінь tasks
 * @param {string | null} parentId
 * @param {Map<string, GraphNode>} nodes
 */
function collectNodes(dir, tasksDir, parentId, nodes) {
  const taskFile = join(dir, 'task.md')
  if (!existsSync(taskFile)) return

  const id = relative(tasksDir, dir).replace(/\\/gu, '/')
  if (!id) return

  const { data } = parseFrontmatter(readSafe(taskFile))

  /** @type {string[]} */
  const deps = Array.isArray(data.deps) ? data.deps.map(String) : []

  const executor = typeof data.executor === 'object' && data.executor !== null
    ? data.executor
    : { type: 'agent', model_tier: 'AVG', skills: [] }

  /** @type {GraphNode} */
  const node = {
    id,
    path: dir,
    parentId,
    deps,
    mode: String(data.mode ?? 'human'),
    executor: {
      type: String(executor.type ?? 'agent'),
      model_tier: String(executor.model_tier ?? 'AVG'),
      skills: Array.isArray(executor.skills) ? executor.skills : [],
    },
    budget_sec: Number(data.budget_sec ?? 1800),
    isComposite: false,
    children: [],
    state: 'needs-plan',
    meta: data,
  }

  nodes.set(id, node)

  // Scan children
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        collectNodes(join(dir, entry.name), tasksDir, id, nodes)
      }
    }
  } catch { /* skip */ }
}

/**
 * Обходить граф знизу вверх (листи → корінь) і деривує стани.
 * @param {string} tasksDir
 * @param {Map<string, GraphNode>} nodes
 * @param {Set<string>} resolvedIds
 * @param {string} worktreesDir
 */
function deriveStatesBottomUp(tasksDir, nodes, resolvedIds, worktreesDir) {
  // Topological sort (Kahn's algorithm by deps within siblings)
  const visited = new Set()
  const order = []

  /** @param {string} id */
  function visit(id) {
    if (visited.has(id)) return
    visited.add(id)
    const node = nodes.get(id)
    if (!node) return
    for (const child of node.children) visit(child)
    order.push(id)
  }

  for (const id of nodes.keys()) visit(id)

  // Process leaves first (order is reversed)
  for (const id of order) {
    const node = nodes.get(id)
    if (!node) continue

    if (node.isComposite) {
      const childStates = node.children.map(cid => nodes.get(cid)?.state ?? 'needs-plan')
      node.state = deriveCompositeState(node.path, childStates)
    } else {
      const depsResolved = node.deps.every(dep => {
        // Deps are sibling IDs — resolve relative to parent
        const siblingId = node.parentId ? `${node.parentId}/${dep}` : dep
        const sibling = nodes.get(siblingId) ?? nodes.get(dep)
        return sibling?.state === 'resolved'
      })
      node.state = deriveAtomicState(node.path, { depsResolved })
    }

    if (node.state === 'resolved') resolvedIds.add(id)
  }
}

/** @param {string} path @returns {string} */
function readSafe(path) {
  try { return readFileSync(path, 'utf8') } catch { return '' }
}
