/**
 * `graph scan` — повне сканування граф: відновлює стан з файлів, виводить результат.
 * exit 0 — граф чистий; exit 1 — є вузли у стані failed.
 */
import { resolve } from 'node:path'
import { cwd } from 'node:process'

import { loadConfig } from './lib/config.mjs'
import { buildDag } from './lib/dag.mjs'

/**
 * @param {string[]} args
 * @param {{ json?: boolean }} opts
 */
export async function runScan(args, opts = {}) {
  const root = cwd()
  const config = loadConfig(root)
  const tasksDir = resolve(root, config.tasks_dir)
  const worktreesDir = resolve(root, config.worktrees_dir)

  const nodes = buildDag(tasksDir, worktreesDir)

  if (opts.json) {
    const out = {}
    for (const [id, node] of nodes) out[id] = { state: node.state, deps: node.deps }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } else {
    printScanTable(nodes)
  }

  const hasFailed = [...nodes.values()].some(n => n.state === 'failed')
  return hasFailed ? 1 : 0
}

/** @param {Map<string, import('./lib/dag.mjs').GraphNode>} nodes */
function printScanTable(nodes) {
  const STATE_ICON = {
    'needs-plan': '⏳',
    waiting: '○',
    blocked: '○',
    running: '◉',
    stalled: '⚠',
    'pending-audit': '🔍',
    resolved: '✓',
    failed: '✗',
    invalidated: '⊘',
  }

  const counts = {}
  for (const { state } of nodes.values()) counts[state] = (counts[state] ?? 0) + 1

  const summary = Object.entries(counts).map(([s, n]) => `${s}:${n}`).join(' ')
  console.log(`graph — ${summary}\n`)

  for (const [id, node] of nodes) {
    const icon = STATE_ICON[node.state] ?? '?'
    let detail = ''
    if (node.state === 'needs-plan') detail = `run: graph plan tasks/${id}/`
    else if (node.state === 'blocked') detail = `blocked: ${node.deps.join(', ')}`
    else if (node.state === 'stalled') detail = 'stalled — deadline passed'
    const suffix = detail ? ` [${detail}]` : ''
    console.log(`  ${icon} ${id.padEnd(30)} [${node.state}]${suffix}`)
  }
}
