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
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_ci_azure.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-parity-ci-azure.test.mjs: wasm-компонент plugin-ci-azure не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-ci-azure/build.sh'
  )
}

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
