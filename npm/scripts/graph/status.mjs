/**
 * `graph status [path]` — стан одного вузла або всього графу.
 */
import { resolve } from 'node:path'
import { cwd } from 'node:process'

import { loadConfig } from './lib/config.mjs'
import { buildDag } from './lib/dag.mjs'

/**
 * @param {string | undefined} path відносний шлях до вузла або undefined для всього графу
 * @param {{ json?: boolean }} opts
 */
export async function runStatus(path, opts = {}) {
  const root = cwd()
  const config = loadConfig(root)
  const tasksDir = resolve(root, config.tasks_dir)
  const worktreesDir = resolve(root, config.worktrees_dir)

  const nodes = buildDag(tasksDir, worktreesDir)

  if (path) {
    // Normalize: tasks/foo → foo, tasks/foo/ → foo
    const id = path.replace(/^tasks\//u, '').replace(/\/$/u, '')
    const node = nodes.get(id)
    if (!node) {
      console.error(`Node not found: ${id}`)
      return 1
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify({ id, ...node }, null, 2) + '\n')
    } else {
      printNode(id, node, nodes)
    }
    return 0
  }

  // Full graph
  if (opts.json) {
    const out = {}
    for (const [id, node] of nodes) {
      out[id] = { state: node.state, deps: node.deps, mode: node.mode, executor: node.executor }
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } else {
    // Print as tree
    const roots = [...nodes.values()].filter(n => !n.parentId)
    const counts = {}
    for (const { state } of nodes.values()) counts[state] = (counts[state] ?? 0) + 1
    const summary = Object.entries(counts).map(([s, n]) => `${s}:${n}`).join(' ')
    console.log(`graph — ${summary}\n`)
    for (const root of roots) printTree(root.id, nodes, 0)
  }
  return 0
}

const ICON = {
  'needs-plan': '⏳', waiting: '○', blocked: '○', running: '◉',
  stalled: '⚠', 'pending-audit': '🔍', resolved: '✓', failed: '✗', invalidated: '⊘',
}

/** @param {string} id @param {Map<string, import('./lib/dag.mjs').GraphNode>} nodes @param {number} depth */
function printTree(id, nodes, depth) {
  const node = nodes.get(id)
  if (!node) return
  const icon = ICON[node.state] ?? '?'
  const indent = '  '.repeat(depth)
  let detail = ''
  if (node.state === 'needs-plan') detail = ` run: graph plan tasks/${id}/`
  else if (node.state === 'blocked') detail = ` blocked: ${node.deps.join(', ')}`
  console.log(`${indent}${icon} ${id}  [${node.state}]${detail}`)
  for (const child of node.children) printTree(child, nodes, depth + 1)
}

/**
 * @param {string} id
 * @param {import('./lib/dag.mjs').GraphNode} node
 * @param {Map<string, import('./lib/dag.mjs').GraphNode>} nodes
 */
function printNode(id, node, nodes) {
  const icon = ICON[node.state] ?? '?'
  console.log(`${icon} ${id}  [${node.state}]`)
  if (node.deps.length) console.log(`  deps: ${node.deps.join(', ')}`)
  if (node.children.length) console.log(`  children: ${node.children.join(', ')}`)
  console.log(`  mode: ${node.mode}  executor: ${node.executor.type}/${node.executor.model_tier}`)
}
