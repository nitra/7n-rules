/**
 * Модульні тести для сканування заборонених імпортів з `vue` (vue.mdc / check-vue), парсер — oxc-parser.
 */
import { describe, expect, test } from 'bun:test'

import {
  contentForVueImportScan,
  extractVueScriptBlocks,
  findForbiddenNodeImportsInText,
  findForbiddenNodeImportsInVueFile,
  findForbiddenVueImportsInSourceFile,
  findForbiddenVueImportsInText,
  isNodeBuiltinSpecifier,
  isVueImportScanSourceFile,
  shouldSkipFileForVueImportScan
} from '../../../utils/vue-forbidden-imports.mjs'

describe('vue-forbidden-imports (oxc)', () => {
  test('дозволені type-only / side-effect — без порушень', () => {
    expect(findForbiddenVueImportsInText(`import 'vue'`, 'x.ts').length).toBe(0)
    expect(findForbiddenVueImportsInText(`import type { Ref } from 'vue'`, 'x.ts').length).toBe(0)
    expect(findForbiddenVueImportsInText(`import type * as V from 'vue'`, 'x.ts').length).toBe(0)
    expect(findForbiddenVueImportsInText(`import { type Ref, type Component } from 'vue'`, 'x.ts').length).toBe(0)
  })

  test('заборонені value-імпорти', () => {
    expect(findForbiddenVueImportsInText(`import { ref } from 'vue'`, 'x.ts').length).toBe(1)
    expect(findForbiddenVueImportsInText(`import { type Ref, ref } from 'vue'`, 'x.ts').length).toBe(1)
    expect(findForbiddenVueImportsInText(`import * as Vue from 'vue'`, 'x.ts').length).toBe(1)
    expect(findForbiddenVueImportsInText(`import Vue from 'vue'`, 'x.ts').length).toBe(1)
  })

  test('findForbiddenVueImportsInText — multiline import', () => {
    const src = `import {
  ref,
  computed
} from 'vue'
`
    const hits = findForbiddenVueImportsInText(src, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].line).toBe(1)
  })

  test('findForbiddenVueImportsInText — не реагує на vue-router', () => {
    const src = `import { useRouter } from 'vue-router'\n`
    expect(findForbiddenVueImportsInText(src, 'x.ts').length).toBe(0)
  })

  test('extractVueScriptBlocks — лише script', () => {
    const sfc = `<template><div /></template>
<script setup lang="ts">
import { ref } from 'vue'
</script>
`
    expect(extractVueScriptBlocks(sfc)).toContain(`import { ref } from 'vue'`)
  })

  test('findForbiddenVueImportsInSourceFile — .vue лише з <script>', () => {
    const sfc = `<template>import { ref } from 'vue'</template>
<script setup>
const x = 1
</script>
`
    expect(findForbiddenVueImportsInSourceFile(sfc, 'x.vue').length).toBe(0)
  })

  test('shouldSkipFileForVueImportScan / isVueImportScanSourceFile', () => {
    expect(shouldSkipFileForVueImportScan('src/auto-imports.d.ts')).toBe(true)
    expect(shouldSkipFileForVueImportScan('src/foo.d.ts')).toBe(true)
    expect(isVueImportScanSourceFile('src/App.vue')).toBe(true)
    expect(isVueImportScanSourceFile('vite.config.ts')).toBe(true)
    expect(isVueImportScanSourceFile('README.md')).toBe(false)
  })

  test('contentForVueImportScan', () => {
    expect(contentForVueImportScan('noop', 'a.ts')).toBe('noop')
    expect(contentForVueImportScan('<script>x</script>', 'a.vue')).toBe('x')
  })
})

describe('vue-forbidden-imports — Node-native у .vue', () => {
  test('isNodeBuiltinSpecifier', () => {
    expect(isNodeBuiltinSpecifier('node:fs')).toBe(true)
    expect(isNodeBuiltinSpecifier('node:timers/promises')).toBe(true)
    expect(isNodeBuiltinSpecifier('fs')).toBe(true)
    expect(isNodeBuiltinSpecifier('fs/promises')).toBe(true)
    expect(isNodeBuiltinSpecifier('path')).toBe(true)
    expect(isNodeBuiltinSpecifier('vue')).toBe(false)
    expect(isNodeBuiltinSpecifier('vue-router')).toBe(false)
    expect(isNodeBuiltinSpecifier('@nitra/consola')).toBe(false)
    expect(isNodeBuiltinSpecifier('./local')).toBe(false)
    expect(isNodeBuiltinSpecifier('')).toBe(false)
  })

  test('findForbiddenNodeImportsInText — node: префікс і bare-built-in', () => {
    const src = `import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'fs'
import { readFile } from 'fs/promises'
import { useRouter } from 'vue-router'
`
    const hits = findForbiddenNodeImportsInText(src, 'x.ts')
    expect(hits.length).toBe(3)
    expect(hits[0].specifier).toBe('node:timers/promises')
    expect(hits[1].specifier).toBe('fs')
    expect(hits[2].specifier).toBe('fs/promises')
  })

  test('findForbiddenNodeImportsInVueFile — лише script у SFC', () => {
    const sfc = `<template><div>fs</div></template>
<script setup lang="ts">
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
const x = 1
</script>
`
    const hits = findForbiddenNodeImportsInVueFile(sfc, 'src/App.vue')
    expect(hits.length).toBe(2)
    expect(hits[0].specifier).toBe('node:timers/promises')
    expect(hits[1].specifier).toBe('node:path')
  })

  test('findForbiddenNodeImportsInVueFile — non-.vue повертає []', () => {
    const src = `import fs from 'node:fs'`
    expect(findForbiddenNodeImportsInVueFile(src, 'foo.ts').length).toBe(0)
  })

  test('findForbiddenNodeImportsInVueFile — чистий SFC без імпортів', () => {
    const sfc = `<template><div /></template>
<script setup>
const a = 1
</script>
`
    expect(findForbiddenNodeImportsInVueFile(sfc, 'x.vue').length).toBe(0)
  })
})
