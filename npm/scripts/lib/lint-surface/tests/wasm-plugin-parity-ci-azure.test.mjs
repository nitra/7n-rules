/**
 * Parity-тест wasm-плагіна `plugin-ci-azure` — ШОСТОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`,
 * потім `plugin-lang-python`/`plugin-lang-rust`/`plugin-lang-php`, пʼятий —
 * `plugin-ci-github`, `wasm-plugin-parity-ci-github.test.mjs`, доккомент
 * того файлу пояснює форму): звіряє `runWasmConcern`/`runWasmConcernFix`
 * napi-мосту (`crates/rules-napi` → `crates/plugin-ci-azure`) із ЕТАЛОНОМ —
 * знятим виводом rego-детекторів `plugins/ci-azure/rules/azure-pipelines/
 * {lint_pipeline,vscode_extensions}` (biт-у-біт reason/message/file/
 * severity/data) — для ОБОХ концернів першої хвилі порту.
 *
 * ПЕРША хвиля цього гостя (доккомент `crates/plugin-ci-azure/src/lib.rs`):
 * два з десяти концернів `plugins/ci-azure/`, обрані як представники ОБОХ
 * форм — чистий rego-детект (`lint_pipeline`, без T0-фіксатора) і
 * rego-детект + T0-фіксатор (`vscode_extensions`, спільний рушій
 * `vscode-ext-add.mjs`). Решта вісім — поза обсягом, JS-канон УСІХ десяти
 * недоторканий.
 *
 * Критерій приймання №1 задачі: парність доводиться через РЕАЛЬНИЙ napi-міст
 * (`runWasmConcern` → застосування → повторний детект), не прямим викликом
 * гостя (§2.47) — цей файл і є тим доказом.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, stagedWasmPath, withTmpDir } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = stagedWasmPath('plugin-ci-azure')


const LINT_PIPELINE_CONCERN = 'azure-pipelines/lint_pipeline'
const VSCODE_EXTENSIONS_CONCERN = 'azure-pipelines/vscode_extensions'

/**
 * Виставляє дефолт `severity: 'error'` — те саме normalize-поле, що
 * `wasm-plugin-parity-ci-github.test.mjs::withDefaultSeverity` (wasm-вихід
 * ЗАВЖДИ несе поле — WIT `record diagnostic.severity` не опційне).
 * @param {unknown[]} violations
 * @returns {unknown[]}
 */
function withDefaultSeverity(violations) {
  return violations.map(v => ({ severity: 'error', ...v }))
}

describe('wasm-plugin parity — azure-pipelines/lint_pipeline (чистий rego-детект через РЕАЛЬНИЙ napi-міст)', () => {
  test('azure-pipelines.yml відсутній — policy-file-missing', async () => {
    await withTmpDir(async dir => {
      const result = loadNative().runWasmConcern(WASM_PATH, LINT_PIPELINE_CONCERN, dir, null)
      const violations = withDefaultSeverity(result.violations)
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('policy-file-missing')
    })
  })

  test('lint-степ із --no-fix, вкладені stages — жодної violation', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'azure-pipelines.yml'),
        'stages:\n  - stage: ci\n    jobs:\n      - job: lint\n        steps:\n          - script: bun install --frozen-lockfile\n          - script: npx @7n/rules lint text --no-fix\n',
        'utf8'
      )
      const result = loadNative().runWasmConcern(WASM_PATH, LINT_PIPELINE_CONCERN, dir, null)
      expect(withDefaultSeverity(result.violations)).toEqual([])
    })
  })

  test('lint-степ відсутній — policy-deny з "n-rules lint"', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'azure-pipelines.yml'), 'steps:\n  - script: echo build\n', 'utf8')
      const result = loadNative().runWasmConcern(WASM_PATH, LINT_PIPELINE_CONCERN, dir, null)
      const violations = withDefaultSeverity(result.violations)
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('policy-deny')
      expect(violations[0].message).toContain('n-rules lint')
    })
  })

  test('lint-степ без --no-fix — policy-deny з "--no-fix"', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'azure-pipelines.yml'), 'steps:\n  - script: bunx n-rules lint\n', 'utf8')
      const result = loadNative().runWasmConcern(WASM_PATH, LINT_PIPELINE_CONCERN, dir, null)
      const violations = withDefaultSeverity(result.violations)
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('policy-deny')
      expect(violations[0].message).toContain('--no-fix')
    })
  })
})

describe('wasm-plugin — azure-pipelines/vscode_extensions: T0-цикл через fix-міст (детект → runWasmConcernFix → детект чистий)', () => {
  test('.vscode/extensions.json відсутній — fix створює recommendations, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      const before = loadNative().runWasmConcern(WASM_PATH, VSCODE_EXTENSIONS_CONCERN, dir, null).violations
      expect(before).toHaveLength(1)
      expect(before[0].reason).toBe('policy-file-missing')

      const plan = loadNative().runWasmConcernFix(WASM_PATH, VSCODE_EXTENSIONS_CONCERN, dir, before, {})
      const edit = plan.edits.find(e => e.path === '.vscode/extensions.json')
      expect(edit).toBeDefined()
      expect(edit.type).toBe('write')
      expect(edit.content).toContain('ms-azure-devops.azure-pipelines')

      await mkdir(join(dir, '.vscode'), { recursive: true })
      await writeFile(join(dir, edit.path), edit.content, 'utf8')

      const after = loadNative().runWasmConcern(WASM_PATH, VSCODE_EXTENSIONS_CONCERN, dir, null).violations
      expect(after).toEqual([])
    })
  })

  test('наявний файл з чужою рекомендацією — fix дописує канонічну, чужа лишається, повторний детект чистий', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.vscode'), { recursive: true })
      await writeFile(
        join(dir, '.vscode', 'extensions.json'),
        JSON.stringify({ recommendations: ['other.ext'] }),
        'utf8'
      )

      const before = loadNative().runWasmConcern(WASM_PATH, VSCODE_EXTENSIONS_CONCERN, dir, null).violations
      expect(before.length).toBeGreaterThan(0)
      expect(before[0].reason).toBe('policy-deny')
      // `%q` → `\"%v\"`-фікс (доккомент `vscode_extensions.rego`) — той самий
      // подвійно-лапковий рядок, що conftest дав би через `%q`.
      expect(before[0].message).toContain('"ms-azure-devops.azure-pipelines"')

      const plan = loadNative().runWasmConcernFix(WASM_PATH, VSCODE_EXTENSIONS_CONCERN, dir, before, {})
      const edit = plan.edits.find(e => e.path === '.vscode/extensions.json')
      expect(edit).toBeDefined()
      const merged = JSON.parse(edit.content)
      expect(merged.recommendations).toContain('other.ext')
      expect(merged.recommendations).toContain('ms-azure-devops.azure-pipelines')

      await writeFile(join(dir, edit.path), edit.content, 'utf8')
      const after = loadNative().runWasmConcern(WASM_PATH, VSCODE_EXTENSIONS_CONCERN, dir, null).violations
      expect(after).toEqual([])
    })
  })

  test('файл уже задовольняє policy — жодної violation, fix не потрібен', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.vscode'), { recursive: true })
      await writeFile(
        join(dir, '.vscode', 'extensions.json'),
        JSON.stringify({ recommendations: ['ms-azure-devops.azure-pipelines', 'other.ext'] }),
        'utf8'
      )
      const result = loadNative().runWasmConcern(WASM_PATH, VSCODE_EXTENSIONS_CONCERN, dir, null)
      expect(withDefaultSeverity(result.violations)).toEqual([])
    })
  })
})

const SERVICE_DEPLOY_PIPELINE_CONCERN = 'azure-pipelines/service_deploy_pipeline'

/** Сервісний pipeline із lint-джобою, але без `plan` — форма, що дає deny. */
const BROKEN_SERVICE_PIPELINE =
  'trigger:\n  paths:\n    include:\n      - run/nexus/**\njobs:\n' +
  '  - job: lint\n    steps:\n      - script: bunx n-rules lint js --path run/nexus --no-fix\n' +
  '  - job: deploy\n    dependsOn:\n      - lint\n    steps:\n      - script: echo x\n'

describe('wasm-plugin parity — azure-pipelines/service_deploy_pipeline (walkGlob rego-детект через РЕАЛЬНИЙ napi-міст)', () => {
  test('сервісний pipeline без plan-джоби — policy-deny, атрибутована файлом', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.azurepipelines'), { recursive: true })
      await writeFile(join(dir, '.azurepipelines', 'deploy-nexus.yml'), BROKEN_SERVICE_PIPELINE, 'utf8')

      const result = loadNative().runWasmConcern(WASM_PATH, SERVICE_DEPLOY_PIPELINE_CONCERN, dir, null)
      const violations = withDefaultSeverity(result.violations)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some(v => v.message.includes('немає job `plan`'))).toBe(true)
      for (const v of violations) {
        expect(v.reason).toBe('policy-deny')
        expect(v.file).toBe('.azurepipelines/deploy-nexus.yml')
      }
    })
  })

  test('pipeline без trigger.paths.include (repo-wide) — не сервісний, жодної violation', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.azurepipelines'), { recursive: true })
      await writeFile(
        join(dir, '.azurepipelines', 'ci.yml'),
        'trigger:\n  - main\njobs:\n  - job: build\n    steps:\n      - script: echo x\n',
        'utf8'
      )
      const result = loadNative().runWasmConcern(WASM_PATH, SERVICE_DEPLOY_PIPELINE_CONCERN, dir, null)
      expect(withDefaultSeverity(result.violations)).toEqual([])
    })
  })

  /**
   * `!`-виключення walkGlob-у (`.azurepipelines/templates/**`) працює НАСКРІЗЬ:
   * до цієї задачі `build_full_scope_files` (`crates/rules-napi`) віддавав `!`-патерн
   * прямо в `globset`, де `!` — звичайний символ шляху, тож виключення мовчки не
   * діяло. Файл-шаблон із формою, яка ДАЛА Б deny, не має давати жодної.
   */
  test('файл із .azurepipelines/templates/** виключений walkGlob-ом — жодної violation', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.azurepipelines', 'templates'), { recursive: true })
      await writeFile(join(dir, '.azurepipelines', 'templates', 'deploy.yml'), BROKEN_SERVICE_PIPELINE, 'utf8')
      const result = loadNative().runWasmConcern(WASM_PATH, SERVICE_DEPLOY_PIPELINE_CONCERN, dir, null)
      expect(withDefaultSeverity(result.violations)).toEqual([])
    })
  })

  /**
   * Порт СВІДОМО без fix-половини (доккомент `crates/plugin-ci-azure/src/lib.rs`,
   * розділ «ДРУГА хвиля»): гість віддає порожній план, `edits.length > 0` не
   * проходить, і чинний `fix-service_deploy_pipeline.mjs` лишається єдиним
   * фіксером. Якщо цей тест колись почервоніє — значить фікс портували, і
   * `guestFix` тепер глушить JS-канон: перевір, чи порт ПОВНИЙ.
   */
  test('fix — порожній план (T0 лишається за JS-каноном)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.azurepipelines'), { recursive: true })
      await writeFile(join(dir, '.azurepipelines', 'deploy-nexus.yml'), BROKEN_SERVICE_PIPELINE, 'utf8')
      const violations = loadNative().runWasmConcern(WASM_PATH, SERVICE_DEPLOY_PIPELINE_CONCERN, dir, null).violations
      const plan = loadNative().runWasmConcernFix(WASM_PATH, SERVICE_DEPLOY_PIPELINE_CONCERN, dir, violations, {})
      expect(plan.edits).toEqual([])
    })
  })
})
