/**
 * Тести виявлення **`gql\`…\``** у тексті джерел (graphql.mdc / graphql-gql-scan.mjs).
 * І інтеграційні тести для check() з tooling.mjs.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { sourceFileHasGqlTaggedTemplate } from '../../lib/graphql-gql-scan.mjs'
import { lint } from '../main.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const check = dir =>
  lint({ cwd: dir, ruleId: 'graphql', concernId: 'tooling', files: undefined }).then(r => r.violations)

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

describe('check (tooling.mjs)', () => {
  test('exit 0 — немає gql шаблонів у джерелах', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'index.js'), 'const x = 1\n', 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })

  test('exit 1 — gql знайдено, .graphqlrc.yml відсутній', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'api.js'), 'const q = gql`query { me { id } }`\n', 'utf8')
      expect((await check(dir)).length).toBeGreaterThan(0)
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
      expect((await check(dir)).length).toBeGreaterThan(0)
    })
  })
})
