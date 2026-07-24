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
const isTazeOrchestratorSkillArgsMock = vi.fn(() => false)
const runAdrNormalizeLocalCliMock = vi.fn(() => 0)
const assertCwdIsProjectRootMock = vi.fn()
const ensureNRulesInRootDevDependenciesMock = vi.fn()
const getHandlersMock = vi.fn(() => [])
const readNRulesConfigLiteMock = vi.fn(() => ({}))
const withGlobalLintLockMock = vi.fn((_opts, fn) => fn())
const createProgressPublisherMock = vi.fn(() => ({ onUpdate: vi.fn(), stop: vi.fn() }))
const detectAllMock = vi.fn(() => ({ exitCode: 0 }))
const runFixPipelineMock = vi.fn(() => 0)
const ensureRunningInWorktreeMock = vi.fn(cwdArg => ({ cwd: cwdArg, autoCreated: false, branchArg: null }))
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
  isTazeOrchestratorSkillArgs: isTazeOrchestratorSkillArgsMock
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
  resolvePluginList: vi.fn(() => []),
  resolvePlugins: vi.fn(() => []),
  resolveRulesDirs: vi.fn(() => []),
  getHandlers: getHandlersMock
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
vi.spyOn(process, 'reallyExit').mockReturnValue()

describe('runCli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  afterEach(() => {
    // Не тягнемо exitCode тестової команди у власний exit-код vitest-процесу.
    process.exitCode = undefined
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
    // Фінальний блок `runCli` (`process.exitCode ?? 0`) завжди виставляє явний 0,
    // навіть якщо жодна гілка switch не торкнулась exitCode.
    expect(process.exitCode).toBe(0)
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

  test('taze резолвить handler @7n/rules-lang-js і делегує у runTazeCli', async () => {
    getHandlersMock.mockReturnValueOnce([{ pluginName: '@7n/rules-lang-js', modulePath: fakeTazeHandlerPath }])
    await runCli(['taze', 'diff'])
    expect(getHandlersMock).toHaveBeenCalled()
    expect(process.exitCode).toBe(0)
    expect(getFakeTazeCliCalls().at(-1)).toEqual(['diff'])
  })

  test('taze без активного @7n/rules-lang-js хендлера → помилка, exitCode 1', async () => {
    getHandlersMock.mockReturnValueOnce([])
    const errSpy = vi.spyOn(console, 'error').mockReturnValue()
    await runCli(['taze', 'diff'])
    expect(process.exitCode).toBe(1)
    expect(errSpy.mock.calls[0][0]).toContain('@7n/rules-lang-js')
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
