/**
 * Тести дельта-диспатчу `runCli` (`../n-rules.js`, `export async function runCli(argv)`)
 * після рефакторингу за `isRunAsCli`-guard.
 *
 * Усі підкоманди-оркестратори, що динамічно чи статично імпортують важкі/мережеві/мутуючі
 * модулі, мокаються через `vi.mock` (hoists — перехоплює і динамічний `import()`): `runCli`
 * ганяємо end-to-end по маршрутизації/парсингу argv без реальної роботи (root-guard,
 * self-upgrade devDependencies, lint-lock, worktree-ізоляція тощо).
 *
 * `assertCwdIsProjectRoot` і `ensureNRulesInRootDevDependencies` мокаються завжди (навіть для
 * команд поза `ROOT_GUARDED_COMMANDS`) — реальний `cwd()` тестового процесу це `npm/`, і без
 * моків ці модулі торкнулись би справжнього робочого дерева репозиторію.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getFakeTazeCliCalls } from './fixtures/fake-lang-js-taze-handler.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fakeTazeHandlerPath = join(here, 'fixtures', 'fake-lang-js-taze-handler.mjs')

const runRenameYamlExtensionsCliMock = vi.fn(() => 0)
const runHookCliMock = vi.fn(() => 0)
const runCiPlanCliMock = vi.fn(() => 0)
const runReleaseCliMock = vi.fn(() => 0)
const runSkillsCliMock = vi.fn(() => 0)
const isJsOrchestratedSkillArgsMock = vi.fn(() => false)
const runAdrNormalizeLocalCliMock = vi.fn(() => 0)
const assertCwdIsProjectRootMock = vi.fn()
const ensureNRulesInRootDevDependenciesMock = vi.fn()
const getSlotContributionsMock = vi.fn(() => [])
const readNRulesConfigLiteMock = vi.fn(() => ({}))
const withGlobalLintLockMock = vi.fn((_opts, fn) => fn())
const createProgressPublisherMock = vi.fn(() => ({ onUpdate: vi.fn(), stop: vi.fn() }))
const detectAllMock = vi.fn(() => ({ exitCode: 0 }))
const runFixPipelineMock = vi.fn(() => 0)
const ensureRunningInWorktreeMock = vi.fn(cwdArg => ({ cwd: cwdArg, autoCreated: false, worktreeName: null }))
const bringChangesBackToOriginalMock = vi.fn(() => ({ failed: false }))
const removeAutoCreatedWorktreeMock = vi.fn()

vi.mock('../rename-yaml-extensions.mjs', () => ({
  runRenameYamlExtensionsCli: runRenameYamlExtensionsCliMock
}))
vi.mock('../../scripts/hook.mjs', () => ({ runHookCli: runHookCliMock }))
vi.mock('../../scripts/lib/lint-surface/ci-plan.mjs', () => ({ runCiPlanCli: runCiPlanCliMock }))
vi.mock('../../rules/release/release.mjs', () => ({ runReleaseCli: runReleaseCliMock }))
vi.mock('../../scripts/skills-cli.mjs', () => ({
  runSkillsCli: runSkillsCliMock,
  isJsOrchestratedSkillArgs: isJsOrchestratedSkillArgsMock
}))
vi.mock('../../scripts/lib/adr/normalize-cli.mjs', () => ({
  runAdrNormalizeLocalCli: runAdrNormalizeLocalCliMock
}))
vi.mock('../../scripts/lib/assert-project-root.mjs', () => ({
  assertCwdIsProjectRoot: assertCwdIsProjectRootMock
}))
vi.mock('../../scripts/ensure-n-rules-dev-dependencies.mjs', () => ({
  ensureNRulesInRootDevDependencies: ensureNRulesInRootDevDependenciesMock
}))
vi.mock('../../scripts/lib/resolve-plugins.mjs', () => ({
  resolvePluginList: vi.fn(() => [])
}))
vi.mock('../../scripts/lib/plugin-slots.mjs', () => ({
  resolveSlotGraph: vi.fn(() => ({})),
  resolveRulesDirs: vi.fn(() => []),
  getSlotContributions: getSlotContributionsMock
}))
vi.mock('../../scripts/lib/read-n-rules-config-lite.mjs', () => ({
  readNRulesConfigLite: readNRulesConfigLiteMock
}))
vi.mock('../../scripts/lib/lint-surface/lint-lock.mjs', () => ({
  withGlobalLintLock: withGlobalLintLockMock,
  createProgressPublisher: createProgressPublisherMock
}))
vi.mock('../../scripts/lib/lint-surface/run-detectors.mjs', () => ({ detectAll: detectAllMock }))
vi.mock('../../scripts/lib/lint-surface/run-fix.mjs', () => ({ runFixPipeline: runFixPipelineMock }))
vi.mock('../../scripts/lib/auto-worktree.mjs', () => ({
  ensureRunningInWorktree: ensureRunningInWorktreeMock,
  bringChangesBackToOriginal: bringChangesBackToOriginalMock,
  removeAutoCreatedWorktree: removeAutoCreatedWorktreeMock
}))

const { runCli } = await import('../n-rules-cli.mjs')

// `runCli` завжди (незалежно від гілки switch) завершується реальним
// `process.emit('exit', exitCode); process.reallyExit(exitCode)` — це існуюча поведінка CLI,
// перенесена всередину функції без змін (див. задачу рефакторингу). `reallyExit` — це
// низькорівневий Node-internal, який миттєво вбиває процес, оминаючи будь-яку обробку events;
// у тестовому воркері (vitest pool: 'forks') він убив би сам тестовий процес. Тому мокається
// лише `reallyExit` (no-op) — `process.emit('exit', …)` лишаємо реальним, він синхронний і
// не завершує процес сам собою.
const reallyExitSpy = vi.spyOn(process, 'reallyExit').mockReturnValue()

describe('runCli', () => {
  // Reset — явний `0`, а не `undefined`: Bun (на відміну від Node) ігнорує
  // присвоєння `process.exitCode = undefined`/`null` і `delete` — раз виставлений
  // код інакше протікав би між тестами під `bun run --bun vitest`.
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = 0
  })

  afterEach(() => {
    // Не тягнемо exitCode тестової команди у власний exit-код vitest-процесу.
    process.exitCode = 0
  })

  test('lint --help друкує довідку без root-guard і без ensure devDependencies', async () => {
    const logSpy = vi.spyOn(console, 'log').mockReturnValue()
    await runCli(['lint', '--help'])
    const text = logSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(text).toContain('Використання: npx @7n/rules lint')
    expect(assertCwdIsProjectRootMock).not.toHaveBeenCalled()
    expect(ensureNRulesInRootDevDependenciesMock).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('lint -h — той самий довідковий шлях', async () => {
    const logSpy = vi.spyOn(console, 'log').mockReturnValue()
    await runCli(['lint', '-h'])
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('невідома команда → stderr "Невідома команда" + exitCode 1', async () => {
    const errSpy = vi.spyOn(console, 'error').mockReturnValue()
    await runCli(['bogus-command-xyz'])
    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls[0][0]).toContain('Невідома команда: bogus-command-xyz')
    errSpy.mockRestore()
  })

  test('legacy alias lint-ga → deprecation warning + маршрутизація в lint ga (root-guard активний)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockReturnValue()
    await runCli(['lint-ga'])
    expect(errSpy.mock.calls[0][0]).toContain('застаріла назва команди')
    expect(assertCwdIsProjectRootMock).toHaveBeenCalledTimes(1)
    expect(ensureNRulesInRootDevDependenciesMock).toHaveBeenCalledTimes(1)
    expect(withGlobalLintLockMock).toHaveBeenCalledTimes(1)
    expect(runFixPipelineMock).toHaveBeenCalledTimes(1)
    errSpy.mockRestore()
  })

  test('rename-yaml-extensions делегує в runRenameYamlExtensionsCli й переносить ненульовий код у exitCode 1', async () => {
    runRenameYamlExtensionsCliMock.mockResolvedValueOnce(2)
    await runCli(['rename-yaml-extensions', '--dry-run'])
    expect(runRenameYamlExtensionsCliMock).toHaveBeenCalledWith(['--dry-run'])
    expect(process.exitCode).toBe(1)
  })

  test('rename-yaml-extensions з кодом 0 — exitCode лишається успішним (0)', async () => {
    runRenameYamlExtensionsCliMock.mockResolvedValueOnce(0)
    await runCli(['rename-yaml-extensions'])
    // Фінальний блок `runCli` (`process.exitCode ?? 0`) завершує процес явним 0.
    // Перевірка — на аргумент `reallyExit`, а не на ambient `process.exitCode`:
    // це спостережуваний exit-код CLI і він не залежить від runtime-нюансів
    // reset-у exitCode (див. коментар у beforeEach).
    expect(process.exitCode).toBe(0)
    expect(reallyExitSpy).toHaveBeenCalledWith(0)
  })

  test('hook делегує у runHookCli і копіює його exitCode', async () => {
    runHookCliMock.mockResolvedValueOnce(2)
    await runCli(['hook', '--post-tool-use'])
    expect(runHookCliMock).toHaveBeenCalledWith(['--post-tool-use'])
    expect(process.exitCode).toBe(2)
  })

  test('ci делегує в runCiPlanCli, без root-guard і без ensure devDependencies', async () => {
    runCiPlanCliMock.mockResolvedValueOnce(0)
    await runCli(['ci', 'plan', '--github'])
    expect(runCiPlanCliMock).toHaveBeenCalledWith(['plan', '--github'])
    expect(assertCwdIsProjectRootMock).not.toHaveBeenCalled()
    expect(ensureNRulesInRootDevDependenciesMock).not.toHaveBeenCalled()
  })

  test('taze резолвить contribution "taze-js" і делегує у runTazeCli', async () => {
    getSlotContributionsMock.mockReturnValueOnce([{ id: 'taze-js', resourcePath: fakeTazeHandlerPath }])
    await runCli(['taze', 'diff'])
    expect(getSlotContributionsMock).toHaveBeenCalledWith(expect.anything(), 'taze.provider', [1])
    expect(process.exitCode).toBe(0)
    expect(getFakeTazeCliCalls().at(-1)).toEqual(['diff'])
  })

  test('taze без активного contribution "taze-js" → помилка, exitCode 1', async () => {
    getSlotContributionsMock.mockReturnValueOnce([])
    const errSpy = vi.spyOn(console, 'error').mockReturnValue()
    await runCli(['taze', 'diff'])
    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls[0][0]).toContain('taze.provider')
    errSpy.mockRestore()
  })

  test('release делегує в runReleaseCli, root-guard активний', async () => {
    runReleaseCliMock.mockResolvedValueOnce(0)
    await runCli(['release', '--bump', 'patch'])
    expect(assertCwdIsProjectRootMock).toHaveBeenCalledTimes(1)
    expect(runReleaseCliMock).toHaveBeenCalledWith(['--bump', 'patch'])
  })

  test('skill делегує в runSkillsCli', async () => {
    runSkillsCliMock.mockResolvedValueOnce(3)
    await runCli(['skill', 'list'])
    expect(runSkillsCliMock).toHaveBeenCalledWith(['list'])
    expect(process.exitCode).toBe(3)
  })

  test('adr-normalize-local делегує в runAdrNormalizeLocalCli', async () => {
    runAdrNormalizeLocalCliMock.mockResolvedValueOnce(0)
    await runCli(['adr-normalize-local'])
    expect(runAdrNormalizeLocalCliMock).toHaveBeenCalledWith([])
  })

  test('lint (дельта, fix-by-default) — root-guard активний, без worktree-ізоляції, runFixPipeline', async () => {
    runFixPipelineMock.mockResolvedValueOnce(0)
    await runCli(['lint', 'ga'])
    expect(assertCwdIsProjectRootMock).toHaveBeenCalledTimes(1)
    expect(ensureRunningInWorktreeMock).not.toHaveBeenCalled()
    expect(withGlobalLintLockMock).toHaveBeenCalledTimes(1)
    expect(runFixPipelineMock).toHaveBeenCalledTimes(1)
    expect(detectAllMock).not.toHaveBeenCalled()
  })

  test('lint --no-fix — detect-only через detectAll, exitCode = detectAll.exitCode', async () => {
    detectAllMock.mockResolvedValueOnce({ exitCode: 3 })
    await runCli(['lint', '--no-fix'])
    expect(detectAllMock).toHaveBeenCalledTimes(1)
    expect(runFixPipelineMock).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(3)
  })

  test('lint --full (без --no-fix) вимагає worktree-ізоляцію через ensureRunningInWorktree', async () => {
    runFixPipelineMock.mockResolvedValueOnce(0)
    await runCli(['lint', '--full'])
    expect(ensureRunningInWorktreeMock).toHaveBeenCalledTimes(1)
    // full+fix — той самий предикат, що й skipDevDepsEnsure: ensure відкладений на runCwd,
    // усередині worktree-блоку (той самий мок покриває обидва місця виклику).
    expect(ensureNRulesInRootDevDependenciesMock).toHaveBeenCalled()
  })

  test('lint --full --no-fix — без worktree-ізоляції (нуль мутацій)', async () => {
    detectAllMock.mockResolvedValueOnce({ exitCode: 0 })
    await runCli(['lint', '--full', '--no-fix'])
    expect(ensureRunningInWorktreeMock).not.toHaveBeenCalled()
    expect(detectAllMock).toHaveBeenCalledTimes(1)
  })

  test('lint --repo-wide з --path кидає помилку конфлікту прапорів', async () => {
    const errSpy = vi.spyOn(console, 'error').mockReturnValue()
    await runCli(['lint', '--repo-wide', '--path', 'run/nexus'])
    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls[0][0]).toContain('--repo-wide не поєднується')
    errSpy.mockRestore()
  })
})
