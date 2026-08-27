/**
 * Тести виявлення **`gql\`…\``** у тексті джерел (graphql.mdc / graphql-gql-scan.mjs).
 * Ця частина не чіпається портом: `graphql-gql-scan.mjs` НЕ входить у `main.mjs`
 * і має другий живий споживач — `scripts/auto-rules.mjs` (предикат `gqlTaggedTemplate`).
 *
 * І інтеграційні тести самого concern-а `graphql/tooling` — через
 * `runConcernDetector` (dispatch-рівень), не пряма функція: JS `main.mjs`
 * видалений (native-порт), concern тепер живе лише в
 * `crates/rules-core/src/concerns/graphql_tooling.rs` і виконується через
 * native-гілку `runConcernDetector` (той самий прийом, що
 * `npm/rules/abie/env_dns/tests/env_dns.test.mjs`).
 */
import { describe, expect, test } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

import { sourceFileHasGqlTaggedTemplate } from '../../lib/graphql-gql-scan.mjs'
import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { ensureDir, linkPackageRoot, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

// Короткий формат ruleId/concernId — узгоджений з `NATIVE_CONCERNS` (`graphql/tooling`).
const ruleId = 'graphql'
const concernId = 'tooling'

// `check_extensions_recommendation` (гілка з наявним `.vscode/extensions.json`)
// доходить до `run_conftest_batch`, який резолвить корінь пакета `@7n/rules` від
// `cwd` (тимчасовий каталог поза репо в `withTmpDir`) — без override там нема
// звідки взяти `npm/rules/graphql/vscode_extensions`. Резолв — symlink
// `node_modules/@7n/rules` усередині `dir` ([`linkPackageRoot`],
// `test-helpers.mjs`), НЕ env-var: `runConcernDetector` тут — in-process
// native-виклик (dlopen, не subprocess), і під Bun (канонічний рантайм,
// `n-bun.mdc`) мутація `process.env`/`env` з JS не доходить до
// `std::env::var` у native-аддоні — `N_RULES_PACKAGE_ROOT`, виставлений
// звідси, native-бік просто не побачив би (доккомент `linkPackageRoot`
// розписує це детально й дає посилання на прецедент того самого класу
// Bun-розбіжності — `ensure-tool.mjs`/`resolve-cmd.mjs`).
const check = async dir => {
  await linkPackageRoot(dir)
  const result = await runConcernDetector(CONCERN, { cwd: dir, ruleId, concernId, files: undefined })
  return result.violations
}

describe('sourceFileHasGqlTaggedTemplate', () => {
  test('true для gql у .ts', () => {
    const src = "import gql from 'graphql-tag'\nconst q = gql`query { me { id } }`\n"
    expect(sourceFileHasGqlTaggedTemplate(src, 'api/foo.ts')).toBe(true)
  })

  test('langFromPath tsx → знаходить gql у .tsx (line 52)', () => {
    const src = 'const q = gql`query { x }`\n'
    expect(sourceFileHasGqlTaggedTemplate(src, 'api/foo.tsx')).toBe(true)
  })

  test('langFromPath jsx → знаходить gql у .jsx (line 58)', () => {
    const src = 'const q = gql`query { x }`\n'
    expect(sourceFileHasGqlTaggedTemplate(src, 'api/foo.jsx')).toBe(true)
  })

  test('синтаксична помилка → false (lines 117/121)', () => {
    expect(sourceFileHasGqlTaggedTemplate('import { from broken\n', 'x.ts')).toBe(false)
  })

  test('true для gql лише в <script> .vue', () => {
    const sfc = `<template><div /></template>\n<script setup>\nimport gql from 'graphql-tag'\nconst q = gql\`{ __typename }\`\n</script>\n`
    expect(sourceFileHasGqlTaggedTemplate(sfc, 'views/App.vue')).toBe(true)
  })

  test('false якщо gql лише в template, не в script', () => {
    const sfc = `<template>{{ \`not gql\` }}</template>\n<script setup>\nconst x = 1\n</script>\n`
    expect(sourceFileHasGqlTaggedTemplate(sfc, 'views/NoGql.vue')).toBe(false)
  })

  test('false для іншого тега graphql', () => {
    const src = 'const q = foo`query { x }`\n'
    expect(sourceFileHasGqlTaggedTemplate(src, 'x.ts')).toBe(false)
  })

  test('false без шаблонів', () => {
    expect(sourceFileHasGqlTaggedTemplate('const x = 1\n', 'a.js')).toBe(false)
  })
})

describe('check (graphql/tooling native concern)', () => {
  test('exit 0 — немає gql шаблонів у джерелах', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'index.js'), 'const x = 1\n', 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })

  test('exit 1 — gql знайдено, .graphqlrc.yml відсутній', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'api.js'), 'const q = gql`query { me { id } }`\n', 'utf8')
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
    })
  })

  test('exit 0 — gql знайдено, .graphqlrc.yml є, extensions.json з graphql.vscode-graphql', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'api.js'), 'const q = gql`query { me { id } }`\n', 'utf8')
      await writeFile(join(dir, '.graphqlrc.yml'), 'schema: schema.graphql\n', 'utf8')
      await ensureDir(join(dir, '.vscode'))
      await writeJson(join(dir, '.vscode/extensions.json'), {
        recommendations: ['graphql.vscode-graphql']
      })
      expect(await check(dir)).toEqual([])
    })
  })

  test('exit 1 — gql знайдено, .graphqlrc.yml є, extensions.json без graphql.vscode-graphql', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'api.js'), 'const q = gql`query { me { id } }`\n', 'utf8')
      await writeFile(join(dir, '.graphqlrc.yml'), 'schema: schema.graphql\n', 'utf8')
      await ensureDir(join(dir, '.vscode'))
      await writeJson(join(dir, '.vscode/extensions.json'), {
        recommendations: ['eslint.vscode-eslint']
      })
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
    })
  })
})
