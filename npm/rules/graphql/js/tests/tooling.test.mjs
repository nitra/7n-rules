/**
 * Тести виявлення **`gql\`…\``** у тексті джерел (graphql.mdc / graphql-gql-scan.mjs).
 */
import { describe, expect, test } from 'bun:test'

import { sourceFileHasGqlTaggedTemplate } from '../graphql-gql-scan.mjs'

describe('sourceFileHasGqlTaggedTemplate', () => {
  test('true для gql у .ts', () => {
    const src = "import gql from 'graphql-tag'\nconst q = gql`query { me { id } }`\n"
    expect(sourceFileHasGqlTaggedTemplate(src, 'api/foo.ts')).toBe(true)
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
