#!/usr/bin/env bun
/**
 * Tool-free experiment: gemma3:4b (text mode, без tools) vs tool-enabled haiku.
 *
 * Оркестратор читає файли детерміновано → будує промпт → gemma3:4b повертає
 * виправлений вміст → оркестратор пише → check-gate через fix --json.
 * При невдачі — ескалація до haiku (tool-enabled via claude-agent-sdk).
 *
 * Мета: перевірити, чи tool-free (~35с/виклик) достатній для простих порушень
 * без накладних витрат tool-call (~97с/крок для gemma4:4b).
 *
 * Usage:
 *   bun run.mjs [--rules rego,style-lint,bun] [--skip-escalation] [--worktree .worktrees/main-tool-free-exp]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '../..')
const N_CURSOR_BIN = join(REPO_ROOT, 'npm/bin/n-cursor.js')
const RESULTS_DIR = join(HERE, 'results')
mkdirSync(RESULTS_DIR, { recursive: true })

// --- CLI args ---
const argv = process.argv.slice(2)
const rulesArg = argv.find(a => a.startsWith('--rules='))?.split('=')[1]
const skipEscalation = argv.includes('--skip-escalation')
const worktreeArg = argv.find(a => a.startsWith('--worktree='))?.split('=')[1]

const DEFAULT_RULES = ['bun', 'rego', 'style-lint']
const TARGET_RULES_LIST = rulesArg ? rulesArg.split(',') : DEFAULT_RULES

// За замовчуванням — наш experiment worktree
const EXPERIMENT_ROOT = worktreeArg
  ? (worktreeArg.startsWith('/') ? worktreeArg : join(REPO_ROOT, worktreeArg))
  : join(REPO_ROOT, '.worktrees/main-tool-free-exp')

// --- Mapping: rule → які файли читати для tool-free промпту ---
const RULE_FILES = {
  bun: ['package-lock.json', 'yarn.lock', '.npmrc', 'package.json'],
  rego: ['.vscode/extensions.json'],
  'style-lint': ['.vscode/extensions.json'],
  ga: ['.github/workflows/ci.yml', '.github/workflows/lint-ga.yml'],
  'js-lint': ['eslint.config.js', 'package.json'],
  text: ['package.json'],
}

/**
 * Витягує назву розширення з рядка порушення.
 * Наприклад: '❌ .vscode/extensions.json: recommendations має містити "tsandall.opa"'
 * → 'tsandall.opa'
 */
function extractExtensionFromViolation(violationText) {
  const m = violationText.match(/recommendations має містити "([^"]+)"/)
  return m?.[1] ?? null
}

/**
 * T0 фікс для violations у .vscode/extensions.json:
 * парсить violation output → додає конкретний рядок → детерміновано, 0 LLM.
 */
function t0ExtensionsJsonFix(root, violationOutput) {
  const extPath = join(root, '.vscode/extensions.json')
  if (!existsSync(extPath)) return false
  const ext = extractExtensionFromViolation(violationOutput)
  if (!ext) return false
  const current = JSON.parse(readFileSync(extPath, 'utf8'))
  const recs = current.recommendations ?? []
  if (recs.includes(ext)) return false
  current.recommendations = [...recs, ext]
  writeFileSync(extPath, JSON.stringify(current, null, 2) + '\n', 'utf8')
  console.log(`  T0 extensions.json: додано "${ext}"`)
  return true
}

// --- T0: детерміністичні виправлення без LLM ---
const T0_FIXES = {
  bun: root => {
    for (const f of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.npmrc']) {
      const p = join(root, f)
      if (existsSync(p)) {
        console.log(`  T0 rm: ${f}`)
        rmSync(p)
      }
    }
    return { status: 'ok', elapsed: 0, tier: 'T0' }
  },
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Запускає `n-cursor fix --json <rules>` у вказаному CWD.
 * Повертає розпарсений об'єкт {total, failed, rules}.
 */
function runFixJson(ruleIds, cwd) {
  const result = spawnSync('bun', [N_CURSOR_BIN, 'fix', '--json', ...ruleIds], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
  })
  const raw = result.stdout?.trim()
  if (!raw) {
    throw new Error(
      `fix --json: порожній stdout (exit ${result.status})\nstderr: ${result.stderr?.slice(0, 300)}`
    )
  }
  return JSON.parse(raw)
}

/**
 * Витягує вміст першого code-block з markdown-відповіді.
 * Підтримує 3+ backtick fences з опційним language hint.
 */
function extractCodeBlock(text) {
  const m = text.match(/`{3,}(?:\w+)?\n([\s\S]*?)`{3,}/)
  return m ? m[1].trim() : text.trim()
}

/**
 * Перевіряє, чи рядок є валідним JSON.
 */
function tryParseJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ─── tool-free worker ─────────────────────────────────────────────────────────

/**
 * Gemma3:4b в text-режимі (без tools).
 * Оркестратор читає файли → будує промпт → pi → парсить відповідь → пише → check.
 *
 * @param {string} ruleId
 * @param {string} projectRoot
 * @param {{ timeout?: number }} opts
 */
async function toolFreeWorker(ruleId, projectRoot, opts = {}) {
  const { timeout = 90_000 } = opts

  // 1. Підтвердити порушення
  const beforeFix = runFixJson([ruleId], projectRoot)
  const ruleResult = beforeFix.rules.find(r => r.ruleId === ruleId)
  if (!ruleResult) return { status: 'error', reason: 'rule not found in fix output' }
  if (ruleResult.ok) return { status: 'skip', reason: 'already clean' }

  const violation = ruleResult.output.slice(0, 600)

  // 2. Прочитати правило
  const mdcPath = join(projectRoot, `.cursor/rules/n-${ruleId}.mdc`)
  const ruleMdc = existsSync(mdcPath) ? readFileSync(mdcPath, 'utf8').slice(0, 2500) : `(rule ${ruleId})`

  // 3. Прочитати файли
  const filePaths = RULE_FILES[ruleId] ?? []
  const fileContents = filePaths
    .map(rel => ({ rel, abs: join(projectRoot, rel) }))
    .filter(({ abs }) => existsSync(abs))
    .map(({ rel, abs }) => ({ path: rel, content: readFileSync(abs, 'utf8') }))

  if (fileContents.length === 0) {
    return { status: 'error', reason: `no files found for rule ${ruleId}` }
  }

  // 4. Побудувати мінімальний промпт.
  // КРИТИЧНО: довгий промпт (>1000 токенів) = prefill >90s на M2 8GB.
  // Не передаємо full mdc — тільки violation + файл + коротка інструкція.
  const targetFile = fileContents[0]
  const prompt = [
    `Fix the rule violation. Return ONLY the complete corrected content of "${targetFile.path}" as a JSON code block.`,
    '',
    `Violation: ${violation.slice(0, 400)}`,
    '',
    `Current content of "${targetFile.path}":`,
    '```json',
    targetFile.content.slice(0, 1500),
    '```',
  ].join('\n')

  // 5. Викликати gemma3:4b (text mode, без tools)
  console.log(`  [tool-free] calling gemma3:4b for ${ruleId}… (timeout ${timeout / 1000}s)`)
  const t0 = performance.now()

  const piArgs = [
    '-p', prompt,
    '--provider', 'ollama',
    '--model', MODEL,
    '--no-session',
    '--mode', 'text',
    ...(MODEL_NO_TOOLS ? ['--no-tools'] : []),
  ]
  console.log(`  [tool-free] model=${MODEL} no-tools=${MODEL_NO_TOOLS}`)
  const piResult = spawnSync('pi', piArgs, { cwd: projectRoot, encoding: 'utf8', timeout })

  const elapsed = Math.round(performance.now() - t0)

  if (piResult.error?.code === 'ETIMEDOUT' || piResult.signal === 'SIGTERM') {
    return { status: 'timeout', elapsed }
  }
  if (piResult.status !== 0 && !piResult.stdout?.trim()) {
    return { status: 'pi-error', elapsed, stderr: piResult.stderr?.slice(0, 200) }
  }

  console.log(`  [tool-free] gemma3:4b responded in ${elapsed}ms`)

  // 6. Парсинг відповіді
  const raw = piResult.stdout ?? ''
  const extracted = extractCodeBlock(raw)
  const parsed = tryParseJson(extracted)
  if (!parsed) {
    return { status: 'parse-error', elapsed, raw: raw.slice(0, 300) }
  }

  // 7. Записати виправлення
  const target = fileContents[0]
  writeFileSync(join(projectRoot, target.path), JSON.stringify(parsed, null, 2) + '\n', 'utf8')
  console.log(`  [tool-free] wrote fix to ${target.path}`)

  // 8. Check-gate
  const afterFix = runFixJson([ruleId], projectRoot)
  const afterRule = afterFix.rules.find(r => r.ruleId === ruleId)
  const ok = afterRule?.ok ?? false

  return { status: ok ? 'ok' : 'check-fail', elapsed }
}

// ─── haiku escalation worker ──────────────────────────────────────────────────

/**
 * Haiku з tools (claude-agent-sdk) — ескалаційний tier.
 */
async function haikuWorker(ruleId, projectRoot) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')

  const ruleMdc = existsSync(join(projectRoot, `.cursor/rules/n-${ruleId}.mdc`))
    ? readFileSync(join(projectRoot, `.cursor/rules/n-${ruleId}.mdc`), 'utf8')
    : ''

  const prompt = [
    `Fix the rule violation for rule "${ruleId}" in the current project.`,
    '',
    `Rule text:`,
    ruleMdc.slice(0, 3000),
    '',
    `Run \`bun ${N_CURSOR_BIN} fix ${ruleId} --json\` in ${projectRoot} to see violations,`,
    `then fix the files, then run check again to confirm fix.`,
  ].join('\n')

  const t0 = performance.now()
  try {
    for await (const _ of query({
      prompt,
      options: {
        cwd: projectRoot,
        maxTurns: 10,
        allowedTools: ['Read', 'Edit', 'Bash'],
        permissionMode: 'bypassPermissions',
        model: 'claude-haiku-4-5-20251001',
      },
    })) { /* drain */ }
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0)
    return { status: 'tier-fail', elapsed, error: String(err.message).slice(0, 100) }
  }

  const elapsed = Math.round(performance.now() - t0)
  const check = runFixJson([ruleId], projectRoot)
  const ok = check.rules.find(r => r.ruleId === ruleId)?.ok
  return { status: ok ? 'ok' : 'check-fail', elapsed }
}

// ─── main ─────────────────────────────────────────────────────────────────────

const MODEL = process.env.TOOL_FREE_MODEL ?? 'gemma3:4b'
const MODEL_NO_TOOLS = MODEL === 'gemma3:4b'

console.log(`\n🧪 Tool-free experiment`)
console.log(`   worktree: ${EXPERIMENT_ROOT}`)
console.log(`   rules: ${TARGET_RULES_LIST.join(', ')}`)
console.log(`   model: ${MODEL}`)
console.log(`   skip-escalation: ${skipEscalation}\n`)

// Pre-warm: завантажити модель у пам'ять (cold-start ~40-60s on M2 8GB).
// Без prewarm перший `pi` виклик у harness майже гарантовано таймаутиться.
console.log(`⏳ Prewarm ${MODEL}…`)
const prewarmT0 = performance.now()
const prewarmResult = spawnSync(
  'pi',
  [
    '-p', 'ok',
    '--provider', 'ollama',
    '--model', MODEL,
    '--no-session',
    '--mode', 'text',
    ...(MODEL_NO_TOOLS ? ['--no-tools'] : []),
  ],
  { encoding: 'utf8', timeout: 180_000 }
)
const prewarmMs = Math.round(performance.now() - prewarmT0)
if (prewarmResult.error?.code === 'ETIMEDOUT' || prewarmResult.status !== 0) {
  console.error(`❌ Prewarm failed (${prewarmMs}ms): ${prewarmResult.stderr?.slice(0, 200)}`)
  process.exit(1)
}
console.log(`✅ Prewarm ok — ${prewarmMs}ms, response: "${prewarmResult.stdout?.trim().slice(0, 30)}"\n`)

if (!existsSync(EXPERIMENT_ROOT)) {
  console.error(`❌ Worktree не знайдено: ${EXPERIMENT_ROOT}`)
  console.error(`   Створіть: git worktree add .worktrees/main-tool-free-exp -b main-tool-free-exp`)
  process.exit(1)
}

/** @type {{ ruleId: string, tier: string, status: string, elapsed: number }[]} */
const ledger = []
const wallStart = performance.now()

for (const ruleId of TARGET_RULES_LIST) {
  console.log(`\n── ${ruleId} ──`)

  // Початковий стан
  let initResult
  try {
    initResult = runFixJson([ruleId], EXPERIMENT_ROOT)
  } catch (err) {
    console.error(`  ❌ fix --json failed: ${err.message}`)
    ledger.push({ ruleId, tier: 'error', status: 'error', elapsed: 0 })
    continue
  }

  const initRule = initResult.rules.find(r => r.ruleId === ruleId)
  if (initRule?.ok) {
    console.log(`  ✅ вже чистий — пропускаємо`)
    ledger.push({ ruleId, tier: 'skip', status: 'ok', elapsed: 0 })
    continue
  }

  console.log(`  ❌ порушення є — запускаємо tool-free worker`)

  // T0 детермінований фікс (відомий тип)
  if (T0_FIXES[ruleId]) {
    console.log(`  ⚙️  T0 fix для ${ruleId}`)
    const t0r = T0_FIXES[ruleId](EXPERIMENT_ROOT)
    const check = runFixJson([ruleId], EXPERIMENT_ROOT)
    const ok = check.rules.find(r => r.ruleId === ruleId)?.ok
    const entry = { ruleId, tier: 'T0', status: ok ? 'ok' : 'check-fail', elapsed: t0r.elapsed ?? 0 }
    ledger.push(entry)
    console.log(`  ${entry.status === 'ok' ? '✅' : '❌'} T0 → ${entry.status}`)
    continue
  }

  // T0 auto-detect: .vscode/extensions.json missing "X" → детермінований патерн
  const ruleViolation = initResult.rules.find(r => r.ruleId === ruleId)?.output ?? ''
  if (extractExtensionFromViolation(ruleViolation)) {
    console.log(`  ⚙️  T0 auto-detect: extensions.json violation`)
    const t0fixed = t0ExtensionsJsonFix(EXPERIMENT_ROOT, ruleViolation)
    if (t0fixed) {
      const check = runFixJson([ruleId], EXPERIMENT_ROOT)
      const ok = check.rules.find(r => r.ruleId === ruleId)?.ok
      ledger.push({ ruleId, tier: 'T0-auto', status: ok ? 'ok' : 'check-fail', elapsed: 0 })
      console.log(`  ${ok ? '✅' : '❌'} T0-auto → ${ok ? 'ok' : 'check-fail'}`)
      continue
    }
  }

  // Tool-free gemma3:4b
  const tfResult = await toolFreeWorker(ruleId, EXPERIMENT_ROOT, { timeout: 90_000 })
  console.log(`  tool-free result: ${JSON.stringify(tfResult)}`)

  if (tfResult.status === 'ok') {
    ledger.push({ ruleId, tier: 'local', status: 'ok', elapsed: tfResult.elapsed })
    console.log(`  ✅ local tool-free → ok в ${tfResult.elapsed}ms`)
    continue
  }

  // Ескалація до haiku
  if (skipEscalation) {
    ledger.push({ ruleId, tier: 'local', status: tfResult.status, elapsed: tfResult.elapsed ?? 0 })
    console.log(`  ⏭️  skip escalation → ${tfResult.status}`)
    continue
  }

  console.log(`  ⬆️  ескалація до haiku…`)
  const haikuResult = await haikuWorker(ruleId, EXPERIMENT_ROOT)
  console.log(`  haiku result: ${JSON.stringify(haikuResult)}`)
  ledger.push({
    ruleId,
    tier: `haiku(after-local-${tfResult.status})`,
    status: haikuResult.status,
    elapsed: (tfResult.elapsed ?? 0) + haikuResult.elapsed,
  })
  console.log(`  ${haikuResult.status === 'ok' ? '✅' : '❌'} haiku → ${haikuResult.status}`)
}

const wallMs = Math.round(performance.now() - wallStart)

// ─── Summary ──────────────────────────────────────────────────────────────────

const resolved = ledger.filter(e => e.status === 'ok').length
const failed = ledger.filter(e => e.status !== 'ok' && e.status !== 'skip').length
const resolvedLocal = ledger.filter(e => e.status === 'ok' && (e.tier === 'local' || e.tier === 'T0')).length

console.log(`\n${'─'.repeat(60)}`)
console.log(`🧪 Tool-free experiment results`)
console.log(`   prewarm: ${prewarmMs}ms (${(prewarmMs / 1000).toFixed(1)}s)`)
console.log(`   rules wall: ${wallMs}ms (${(wallMs / 1000).toFixed(1)}s)`)
console.log(`   total: ${prewarmMs + wallMs}ms (${((prewarmMs + wallMs) / 1000).toFixed(1)}s)`)
console.log(`   resolved: ${resolved}/${ledger.length}`)
console.log(`   local (T0+tool-free): ${resolvedLocal}/${ledger.length}`)
console.log(`   failed: ${failed}`)
console.log()
console.log('Ledger:')
for (const e of ledger) {
  const icon = e.status === 'ok' ? '✅' : e.status === 'skip' ? '⏭' : '❌'
  console.log(`  ${icon} ${e.ruleId.padEnd(12)} tier=${e.tier.padEnd(6)} status=${e.status} elapsed=${e.elapsed}ms`)
}

// Save results
const ts = new Date().toISOString().replaceAll(/[:.]/g, '-')
const result = { ts, wallMs, rules: TARGET_RULES_LIST, ledger, resolved, failed, resolvedLocal }
const outPath = join(RESULTS_DIR, `tool-free-${ts}.json`)
writeFileSync(outPath, JSON.stringify(result, null, 2))
console.log(`\n→ results saved: ${outPath}`)
