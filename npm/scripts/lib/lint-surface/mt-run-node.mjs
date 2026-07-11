/**
 * B2 — executor-міст: виконання fix-вузла MT нашим pi-harness (Фаза B, spec
 * docs/specs/2026-07-11-phase-b-lint-mt-adapter-dev-design.md).
 *
 * MT-runner (node_executor, `@7n/mt`#29) спавнить цю команду замість вбудованого
 * Claude-шляху для actor=agent вузлів. Контракт (з #29):
 *   - argv[0] / `MT_NODE_DIR` = директорія вузла (task.md + a.md);
 *   - `MT_WORKTREE` = дерево, у якому застосовувати зміни (cwd фіксу);
 *   - `MT_MODEL_TIER` = MIM|AVG|MAX (дублює a.md);
 *   - stdout = JSON `{applied, touchedFiles}`; exit 0 → MT ганяє `## Check` і
 *     синтезує fact; ненульовий → failed-run.
 * MT володіє claim/lease, worktree-ізоляцією, budget/timeout, `## Check`, publish;
 * екзекутор ЛИШЕ «застосуй зміни» нашим тир-каноном (omlx/pi-тири llm-lib).
 *
 * Екзекутор НЕ re-detect-ить: canonical-гейт — `## Check` за MT. violation-текст
 * будується з контракту вузла (task.md ## Task + target-файли), агент читає файли
 * й правило сам. Чисте ядро (парсинг контракту, tier-мапінг) — тестовне; fix
 * інжектується через `deps`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'

/** MT model_tier → llm-lib tier-label (для resolveModel/thinkingLevel). */
const TIER_MAP = { MIM: 'min', AVG: 'avg', MAX: 'max' }

/** Правило з `## Check`-команди (`lint --no-fix <rule>`). */
const RE_CHECK_RULE = /lint\s+--no-fix\s+(\S+)/
/** Рядок target-файлу в `## Inputs` (`- \`path\``). */
const RE_INPUT_FILE = /^- `([^`]+)`/

/**
 * Витягує правило з `## Check`-команди вузла (`lint --no-fix <rule>`).
 * @param {string} taskMd вміст task.md
 * @returns {string|null} id правила або null
 */
function parseRule(taskMd) {
  const m = RE_CHECK_RULE.exec(taskMd)
  return m ? m[1] : null
}

/**
 * Витягує target-файли з секції Inputs (bullet-рядки з path у backtick-ах).
 * @param {string} taskMd вміст task.md
 * @returns {string[]} перелік файлів (whole-repo маркер відкидається)
 */
function parseTargetFiles(taskMd) {
  const idx = taskMd.indexOf('## Inputs')
  if (idx === -1) return []
  const section = taskMd.slice(idx)
  const files = []
  for (const line of section.split('\n')) {
    const m = RE_INPUT_FILE.exec(line.trim())
    if (m && !m[1].startsWith('(')) files.push(m[1])
  }
  return files
}

/**
 * Парсить контракт вузла з task.md.
 * @param {string} taskMd вміст task.md
 * @returns {{ rule: string|null, targetFiles: string[], taskText: string }} контракт
 */
export function parseNodeContract(taskMd) {
  const taskIdx = taskMd.indexOf('## Task')
  const doneIdx = taskMd.indexOf('## Done when')
  const end = doneIdx === -1 ? taskMd.length : doneIdx
  const taskText = taskIdx === -1 ? '' : taskMd.slice(taskIdx + '## Task'.length, end).trim()
  return { rule: parseRule(taskMd), targetFiles: parseTargetFiles(taskMd), taskText }
}

/**
 * MT model_tier → llm-lib tier-label. Невідоме/відсутнє → 'avg'.
 * @param {string|undefined} mtTier MIM|AVG|MAX
 * @returns {'min'|'avg'|'max'} tier-label
 */
export function resolveTierLabel(mtTier) {
  return TIER_MAP[String(mtTier ?? '').toUpperCase()] ?? 'avg'
}

/**
 * Будує violation-текст для агента з контракту вузла (без re-detect —
 * canonical-гейт лишається за MT `## Check`).
 * @param {{ rule: string|null, targetFiles: string[], taskText: string }} contract контракт
 * @returns {string} опис проблеми для runAgentFix
 */
export function buildViolationText(contract) {
  const parts = [contract.taskText || `Порушення правила ${contract.rule ?? '(невідоме)'}.`]
  if (contract.targetFiles.length > 0) {
    parts.push(`Target-файли: ${contract.targetFiles.join(', ')}.`)
  }
  return parts.join('\n')
}

/**
 * Дефолтний fix через pi-harness (lazy import — тримає top-level pi-free).
 * @param {{ rule: string, violation: string, cwd: string, tier: string, targetFiles: string[] }} args параметри
 * @returns {Promise<{ applied: boolean, touchedFiles: string[], error: string|null }>} результат
 */
async function defaultFix({ rule, violation, cwd, tier, targetFiles }) {
  const [{ runAgentFix }, { resolveModel }] = await Promise.all([
    import('@7n/llm-lib/agent-fix'),
    import('@7n/llm-lib/model-tiers')
  ])
  const res = await runAgentFix(rule, violation, cwd, {
    model: resolveModel(tier),
    tier,
    targetFiles,
    caller: `mt-run-node:${rule}`
  })
  return { applied: res.applied, touchedFiles: res.touchedFiles ?? [], error: res.error }
}

/**
 * Виконує один MT-вузол: парсить контракт, застосовує фікс нашим harness у worktree.
 * @param {{ nodeDir: string, worktree: string, mtTier?: string,
 *   deps?: { readFile?: (p: string) => string, fix?: typeof defaultFix } }} args параметри
 * @returns {Promise<{ applied: boolean, touchedFiles: string[], error: string|null }>} результат для stdout
 */
export async function runNode({ nodeDir, worktree, mtTier, deps = {} }) {
  const read = deps.readFile ?? (p => readFileSync(p, 'utf8'))
  const fix = deps.fix ?? defaultFix

  let taskMd
  try {
    taskMd = read(join(nodeDir, 'task.md'))
  } catch (error) {
    return { applied: false, touchedFiles: [], error: `не прочитано task.md: ${error.message}` }
  }
  const contract = parseNodeContract(taskMd)
  if (!contract.rule) return { applied: false, touchedFiles: [], error: 'не знайдено правило у ## Check' }

  const tier = resolveTierLabel(mtTier)
  return await fix({
    rule: contract.rule,
    violation: buildViolationText(contract),
    cwd: worktree,
    tier,
    targetFiles: contract.targetFiles
  })
}

/**
 * CLI-ентрі node_executor: argv[0]=node-dir; env MT_WORKTREE/MT_MODEL_TIER.
 * Друкує JSON `{applied, touchedFiles}` у stdout; повертає exit-код (0 — успіх
 * виконання, MT далі ганяє `## Check`; 1 — помилка екзекутора).
 * @param {string[]} argv аргументи (без node/script)
 * @param {{ env?: Record<string, string|undefined>, out?: (s: string) => void, run?: typeof runNode }} [deps] інʼєкції
 * @returns {Promise<number>} exit-код
 */
export async function runNodeCli(argv, deps = {}) {
  const e = deps.env ?? env
  const out = deps.out ?? (s => process.stdout.write(s))
  const run = deps.run ?? runNode
  const nodeDir = argv[0] ?? e.MT_NODE_DIR
  if (!nodeDir) {
    out(`${JSON.stringify({ applied: false, touchedFiles: [], error: 'не задано node-dir (argv/MT_NODE_DIR)' })}\n`)
    return 1
  }
  const res = await run({ nodeDir, worktree: e.MT_WORKTREE ?? nodeDir, mtTier: e.MT_MODEL_TIER })
  out(`${JSON.stringify({ applied: res.applied, touchedFiles: res.touchedFiles })}\n`)
  return res.error ? 1 : 0
}
