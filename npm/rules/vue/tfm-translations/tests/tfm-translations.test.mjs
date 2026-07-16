/**
 * Тести concern-а vue/tfm-translations: якщо `.vue` імпортує `tf` з `@nitra/tfm`, у файлі
 * має бути оголошена функція `getTr()` з перекладами (vue.mdc tfm-translations).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { lint } from '../main.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const run = (dir, files) => lint({ cwd: dir, ruleId: 'vue', concernId: 'tfm-translations', files })

describe('check vue.tfm-translations', () => {
  test('успіх: використовує tf і оголошує getTr() → без порушень', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Page.vue'),
        `<template>{{ t\`Клиенты\` }}</template>
<script setup>
import { lang, tf as tfm } from '@nitra/tfm'
const t = tfm.bind({ tr: getTr() })

function getTr() {
  return { Клиенты: { en: 'Customers' } }
}
</script>
`
      )
      const { violations } = await run(dir, ['Page.vue'])
      expect(violations).toEqual([])
    })
  })

  test('порушення: імпортує tf, але не оголошує getTr()', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Page.vue'),
        `<script setup>
import { tf } from '@nitra/tfm'
const t = tf.bind({ tr: {} })
</script>
`
      )
      const { violations } = await run(dir, ['Page.vue'])
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0].message).toContain('getTr')
    })
  })

  test('успіх: не використовує @nitra/tfm взагалі → без порушень', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Page.vue'), '<template><div /></template>\n<script setup></script>\n')
      const { violations } = await run(dir, ['Page.vue'])
      expect(violations).toEqual([])
    })
  })

  test('успіх: імпортує з @nitra/tfm, але не саме tf (напр. лише lang) → без порушень', async () => {
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'Page.vue'),
        `<script setup>
import { lang } from '@nitra/tfm'
</script>
`
      )
      const { violations } = await run(dir, ['Page.vue'])
      expect(violations).toEqual([])
    })
  })

  test('не .vue файли не скануються', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/helper.mjs'), "import { tf } from '@nitra/tfm'\n")
      const { violations } = await run(dir, ['src/helper.mjs'])
      expect(violations).toEqual([])
    })
  })

  test('без ctx.files (full-run без delta) → без порушень', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Page.vue'), "<script setup>\nimport { tf } from '@nitra/tfm'\n</script>\n")
      const { violations } = await lint({ cwd: dir, ruleId: 'vue', concernId: 'tfm-translations' })
      expect(violations).toEqual([])
    })
  })
})
