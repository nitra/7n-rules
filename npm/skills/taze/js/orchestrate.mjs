/** @see ./docs/orchestrate.md */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'
import { collectTazeDiff } from './diff.mjs'

/** Суфікс бекапу package.json — той самий, що й у `diff.mjs`/кроці 1 SKILL.md. */
const BACKUP_SUFFIX = '.taze-bak'

/**
 * Промпт ОДНОГО ітеративного виклику — лише кроки 4-6 SKILL.md (breaking
 * changes → сумісність коду → рефакторинг) для ОДНОГО major-пакета. Кроки
 * 1-3/7/8 виконує оркестратор детерміновано, без LLM.
 * @param {{workspace: string, pkg: string, from: string, to: string}} entry запис major-diff (з `collectTazeDiff`)
 * @returns {string} готовий промпт
 */
export function buildDependencyPrompt({ workspace, pkg, from, to }) {
  return [
    '# Major-оновлення одного пакета: перевірка сумісності й рефакторинг',
    '',
    `Пакет \`${pkg}\` у воркспейсі \`${workspace}\`: **${from} → ${to}** — вже застосовано в package.json/bun.lock (кроки 1-3 виконано детерміновано, без тебе). Твоя задача — лише breaking-changes-перевірка й, за потреби, рефакторинг.`,
    '',
    '## Кроки',
    `1. Зібрати breaking changes цього оновлення: CHANGELOG/Releases репозиторію модуля (поле \`repository\` у \`node_modules/${pkg}/package.json\`), або git/diff між закешованою старою версією (\`~/.bun/install/cache/${pkg}@<стара-версія>/\`) і новою (\`node_modules/${pkg}/\`).`,
    `2. Знайти використання зачепленого API в коді проєкту (\`rg -n\` по імпортах/викликах \`${pkg}\`).`,
    '3. Сумісно — нічого не робити. Несумісно — застосувати міграцію (перейменувати імпорт, оновити сигнатуру виклику, замінити видалену опцію еквівалентом).',
    '4. Якщо були правки — запусти `npx @7n/rules lint`, typecheck/test якщо є в проєкті.',
    '5. Нетривіальна/неоднозначна міграція — не вгадуй, залиш TODO-коментар із посиланням на CHANGELOG.',
    '',
    'У відповіді одним абзацом підсумуй: сумісно / зрефакторено (які файли) / TODO (чому).'
  ].join('\n')
}

/**
 * Диспетчер одного ітеративного виклику на обраний раннер. `pi` — вбудований
 * pi-агент (`@7n/llm-lib/agent-skill`; текст перехоплюється через `deps.out`,
 * бо `runAgentSkill` не повертає його напряму — лише стрімить у stdout).
 * `cursor`/`codex` — napi-міст ACP (`@7n/llm-lib/acp`; текст — прямий return,
 * idle-timeout і видимість прогресу вже вбудовані в сам міст).
 * @param {'pi' | 'cursor' | 'codex'} runner раннер
 * @param {string} prompt промпт для одного пакета
 * @param {string} cwd робочий каталог
 * @param {{ runAgentSkill?: (prompt: string, opts?: object) => Promise<{ok: boolean, error: string|null}>, runAcpAgent?: (kind: string, prompt: string, cwd: string) => Promise<string> }} [deps] інжекти для тестів
 * @returns {Promise<{ ok: boolean, text: string, error: string|null }>} результат виклику
 */
export async function callRunner(runner, prompt, cwd, deps = {}) {
  if (runner === 'pi') {
    let runAgentSkill = deps.runAgentSkill
    if (!runAgentSkill) {
      const agentSkillModule = await import('@7n/llm-lib/agent-skill')
      runAgentSkill = agentSkillModule.runAgentSkill
    }
    let text = ''
    const result = await runAgentSkill(prompt, {
      skillId: 'taze',
      tier: 'avg',
      cwd,
      deps: { out: chunk => (text += chunk) }
    })
    return { ok: result.ok, text, error: result.error }
  }

  let runAcpAgent = deps.runAcpAgent
  if (!runAcpAgent) {
    const acpModule = await import('@7n/llm-lib/acp')
    runAcpAgent = acpModule.runAcpAgent
  }
  try {
    const text = await runAcpAgent(runner, prompt, cwd)
    return { ok: true, text, error: null }
  } catch (error) {
    return { ok: false, text: '', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Перевіряє, що `cwd` — ізольований worktree (`main.json.worktree: true`,
 * той самий контракт, що й для інших worktree-only скілів). Раніше цю
 * гарантію тримав агент, читаючи SKILL.md-preflight як частину промпту;
 * оркестратор більше НЕ годує SKILL.md жодному викликові, тож без цієї
 * перевірки `bunx taze -w -r latest`/`bun install` мовчки виконались би
 * прямо в основному дереві виклику. Кидає, якщо `git rev-parse --show-toplevel`
 * не містить `.worktrees` як сегмент шляху (покриває і `npx \@7n/mt worktree
 * create`-конвенцію `.worktrees/`, і сесійну `.claude/worktrees/`).
 * @param {string} cwd каталог для перевірки
 * @param {typeof spawnSync} spawnFn інжект для тестів
 * @returns {void}
 */
function assertRunningInWorktree(cwd, spawnFn) {
  const result = spawnFn('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  const toplevel = result.status === 0 ? result.stdout.trim() : ''
  const segments = new Set(toplevel.replaceAll('\\', '/').split('/'))
  if (!segments.has('.worktrees')) {
    throw new Error(
      `taze: "${cwd}" не в ізольованому worktree (git toplevel: "${toplevel || '?'}"). ` +
        'main.json.worktree=true вимагає окремого дерева — створи його спершу (див. SKILL.md preflight), не запускай taze в основному дереві.'
    )
  }
}

/**
 * Синхронно виконує детерміновану команду (bunx/bun/find), кидає з
 * exit-кодом+stderr при провалі.
 * @param {string} cmd бінарник
 * @param {string[]} args аргументи
 * @param {string} cwd робочий каталог
 * @param {typeof spawnSync} spawnFn інжект для тестів
 * @returns {string} stdout
 */
function runCommand(cmd, args, cwd, spawnFn) {
  const result = spawnFn(cmd, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} → exit ${result.status}: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

/**
 * Бекапить package.json кожного воркспейсу (крок 1 SKILL.md) — потрібно для
 * класифікації major/minor через `collectTazeDiff` після bump-у.
 * @param {string} cwd корінь репо
 * @param {{ getMonorepoPackageRootDirs?: (cwd: string) => Promise<string[]>, copyFile?: (src: string, dest: string) => Promise<void> }} [deps] інжекти
 * @returns {Promise<string[]>} відносні шляхи воркспейсів, що мали package.json
 */
export async function backupWorkspacePackageFiles(cwd, deps = {}) {
  const getRoots = deps.getMonorepoPackageRootDirs ?? getMonorepoPackageRootDirs
  const copy = deps.copyFile ?? copyFile
  const roots = await getRoots(cwd)
  const backedUp = []
  for (const ws of roots) {
    const pkgPath = join(cwd, ws, 'package.json')
    if (!existsSync(pkgPath)) continue
    await copy(pkgPath, `${pkgPath}${BACKUP_SUFFIX}`)
    backedUp.push(ws)
  }
  return backedUp
}

/**
 * Прибирає бекапи package.json після завершення (крок 7 SKILL.md).
 * @param {string} cwd корінь репо
 * @param {string[]} workspaces воркспейси з бекапом (з `backupWorkspacePackageFiles`)
 * @param {{ rm?: (path: string, opts?: object) => Promise<void> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function cleanupBackups(cwd, workspaces, deps = {}) {
  const remove = deps.rm ?? rm
  for (const ws of workspaces) {
    await remove(join(cwd, ws, `package.json${BACKUP_SUFFIX}`), { force: true })
  }
}

/**
 * Знаходить Cargo.toml поза node_modules/.worktrees/target (крок 0.2
 * SKILL.md). Лише інформаційно — v1 оркестратора Rust-крейти не оновлює
 * (немає детермінованого cargo-diff-еквівалента `collectTazeDiff`,
 * класифікація major там ручна за SKILL.md).
 * @param {string} cwd корінь репо
 * @param {{ spawnFn?: typeof spawnSync }} [deps] інжект
 * @returns {string[]} відносні шляхи знайдених Cargo.toml
 */
export function findCargoManifests(cwd, deps = {}) {
  const spawnFn = deps.spawnFn ?? spawnSync
  const result = spawnFn(
    'find',
    [
      '.',
      '-name',
      'Cargo.toml',
      '-not',
      '-path',
      '*/node_modules/*',
      '-not',
      '-path',
      '*/.worktrees/*',
      '-not',
      '-path',
      '*/target/*'
    ],
    { cwd, encoding: 'utf8' }
  )
  return (result.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

/**
 * Компонує підсумковий звіт (крок 8 SKILL.md) детерміновано з результатів
 * ітерацій — без окремого LLM-виклику для самого звіту.
 * @param {{ minorPatch: number, totalChanged: number, results: Array<{pkg:string, workspace:string, from:string, to:string, ok:boolean, error:string|null}>, rustCrates: string[] }} args дані звіту
 * @returns {string} markdown-звіт
 */
export function formatReport({ minorPatch, totalChanged, results, rustCrates }) {
  const lines = [
    '## taze: підсумок',
    '',
    `- **Оновлено (minor/patch):** ${minorPatch}`,
    `- **Major-оновлення:** ${results.length}`
  ]
  for (const r of results) {
    const status = r.ok ? '✅' : '❌'
    const errorSuffix = r.error ? ` — ${r.error}` : ''
    lines.push(`  ${status} \`${r.pkg}\` (${r.workspace}): ${r.from} → ${r.to}${errorSuffix}`)
  }
  if (rustCrates.length > 0) {
    lines.push(
      '',
      `- **Rust-крейти (${rustCrates.length}), потребують ручного прогону Rust-гілки SKILL.md:** ${rustCrates.join(', ')}`
    )
  }
  lines.push('', `- **Всього змінено:** ${totalChanged}`)
  return lines.join('\n')
}

/**
 * Оркеструє taze: детерміновані кроки (бекап → масовий bump → diff →
 * прибирання → звіт) без LLM, і по одному ізольованому, обмеженому по
 * обсягу виклику `callRunner` на кожен major-пакет (кроки 4-6 SKILL.md) —
 * замість одного величезного непрозорого ходу на весь монорепо. Кожен
 * виклик успадковує власний timeout/idle-timeout раннера, тож падіння
 * одного пакета не втрачає прогрес по інших.
 * @param {{
 *   cwd?: string,
 *   runner?: 'pi' | 'cursor' | 'codex',
 *   log?: (line: string) => void,
 *   deps?: { spawnFn?: typeof spawnSync, collectTazeDiff?: (cwd: string) => Promise<object>, callRunner?: (runner: string, prompt: string, cwd: string, deps: object) => Promise<{ok: boolean, text: string, error: string|null}> } & Record<string, unknown>
 * }} [options] опції + інжекти для тестів
 * @returns {Promise<{ ok: boolean, report: string, results: Array<object> }>} результат
 */
export async function runTazeOrchestrator(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const runner = options.runner ?? 'pi'
  const log = options.log ?? (line => console.log(line))
  const deps = options.deps ?? {}
  const spawnFn = deps.spawnFn ?? spawnSync

  assertRunningInWorktree(cwd, spawnFn)

  const rustCrates = findCargoManifests(cwd, { spawnFn })

  log('📦 Бекап package.json...')
  const backedUpWorkspaces = await backupWorkspacePackageFiles(cwd, deps)

  log('⬆️  bunx taze -w -r latest...')
  runCommand('bunx', ['taze', '-w', '-r', 'latest'], cwd, spawnFn)
  log('📥 bun install...')
  runCommand('bun', ['install'], cwd, spawnFn)

  const collectDiff = deps.collectTazeDiff ?? collectTazeDiff
  const diff = await collectDiff(cwd)
  log(`🔍 diff: ${diff.major.length} major, ${diff.minorPatch} minor/patch`)

  const results = []
  const call = deps.callRunner ?? callRunner
  for (const entry of diff.major) {
    log(`🔧 ${entry.pkg} (${entry.workspace}): ${entry.from} → ${entry.to}...`)
    const outcome = await call(runner, buildDependencyPrompt(entry), cwd, deps)
    results.push({ ...entry, ...outcome })
    log(outcome.ok ? `  ✅ ${entry.pkg}` : `  ❌ ${entry.pkg}: ${outcome.error}`)
  }

  await cleanupBackups(cwd, backedUpWorkspaces, deps)

  const report = formatReport({ minorPatch: diff.minorPatch, totalChanged: diff.totalChanged, results, rustCrates })
  log(report)

  return { ok: results.every(r => r.ok), report, results }
}
