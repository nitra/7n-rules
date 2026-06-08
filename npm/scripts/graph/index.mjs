/**
 * `n-cursor graph` — CLI entry point для нової graph-архітектури.
 * Реалізує команди з docs/думка.MD (фінальний дизайн 2026-06-07).
 */

/**
 * @param {string[]} argv процесні аргументи після 'graph'
 * @returns {Promise<number>} exit code
 */
export async function runGraphCli(argv) {
  const [cmd, ...rest] = argv

  const hasJson = rest.includes('--json')
  const cleanRest = rest.filter(a => a !== '--json')

  switch (cmd) {
    case 'scan':
      return (await import('./scan.mjs')).runScan(cleanRest, { json: hasJson })

    case 'status': {
      const path = cleanRest[0]
      return (await import('./status.mjs')).runStatus(path, { json: hasJson })
    }

    case 'setup':
      return (await import('./setup.mjs')).runSetup(cleanRest)

    case 'init': {
      const [name, ...initRest] = cleanRest
      return (await import('./init.mjs')).runInit(name, parseFlags(initRest))
    }

    case 'plan': {
      const flags = parseFlags(cleanRest)
      return (await import('./plan.mjs')).runPlan(flags.path, flags)
    }

    case 'run': {
      const flags = parseFlags(cleanRest)
      return (await import('./run.mjs')).runRun(flags.path, flags)
    }

    case 'kill': {
      const path = cleanRest[0]
      return (await import('./kill.mjs')).runKill(path)
    }

    case 'invalidate': {
      const flags = parseFlags(cleanRest)
      return (await import('./invalidate.mjs')).runInvalidate(flags.path, flags)
    }

    case 'done':
    case 'audit':
    case 'failed':
    case 'spawn': {
      const path = cleanRest[0]
      return (await import('./signals.mjs')).runSignal(cmd, path, parseFlags(cleanRest.slice(1)))
    }

    case undefined:
    case '--help':
    case 'help':
      printHelp()
      return 0

    default:
      console.error(`Unknown graph command: ${cmd}`)
      printHelp()
      return 1
  }
}

/** @param {string[]} args @returns {Record<string, string | boolean>} */
function parseFlags(args) {
  /** @type {Record<string, string | boolean>} */
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else if (!flags.path) {
      flags.path = a
    }
  }
  return flags
}

function printHelp() {
  console.log(`n-cursor graph <command> [options]

Commands:
  setup                              Initialize project (.n-cursor.json, hooks)
  init <name> [--task "..."]         Create task.md for a new node
  plan [<path>] [--mode agent]       Stage 1: spec + decompose → plan_NNN.md
  status [<path>] [--json]           Show graph or node state
  scan [--json]                      Full scan; exit 1 if any failed nodes
  run [<path>] [--actor a] [--auto]  Execute node or run orchestrator
  kill <path>                        Kill worktrees + cascade invalidate
  invalidate <path> [--no-cascade]   Mark node as invalidated

Agent signals (called from within worktree):
  done <path>                        Signal success → merge
  audit <path>                       Request audit → pending-audit_NNN.md
  failed <path>                      Signal failure
  spawn <path>                       Register composite subgraph
`)
}
