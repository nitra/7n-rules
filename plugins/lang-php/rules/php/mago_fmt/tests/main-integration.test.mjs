/**
 * Integration-тести detector-а `php/mago_fmt`: реальний `mago` (жодних моків
 * `ensureToolAsync`/`spawnAsync`) на tmp-фікстурі. `describe.skipIf(!hasMago)` — пропускає
 * весь файл, якщо `mago` не резолвиться в PATH (патерн `k8s/hasura_configmap`/`hasConftest`),
 * замість тягнути мережевий auto-install у пісочниці без мережі. Перший тест піднімає
 * timeout до 30s — cold-cache перший виклик `ensureToolAsync` теоретично може тягнути
 * install (патерн `opa_check/tests/main.test.mjs`), хоч локально з прогрітим PATH/кешем
 * резолв миттєвий.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

import { lint } from '../main.mjs'

const hasMago = Boolean(resolveCmd('mago'))

const FORMATTED_PHP = `<?php

declare(strict_types=1);

function add(int $a, int $b): int
{
    return $a + $b;
}
`

const UNFORMATTED_PHP = `<?php
function add($a,$b) {
return $a+$b;
}
`

describe.skipIf(!hasMago)('php/mago_fmt detector — real mago', () => {
  test('відформатований файл → без порушень', { timeout: 30_000 }, async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await writeFile(join(dir, 'Formatted.php'), FORMATTED_PHP, 'utf8')
      const { violations } = await lint({
        cwd: dir,
        ruleId: 'php',
        concernId: 'mago_fmt',
        files: ['Formatted.php']
      })
      expect(violations).toHaveLength(0)
    })
  })

  test('неформатований файл → mago-fmt-unformatted', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await writeFile(join(dir, 'Unformatted.php'), UNFORMATTED_PHP, 'utf8')
      const { violations } = await lint({
        cwd: dir,
        ruleId: 'php',
        concernId: 'mago_fmt',
        files: ['Unformatted.php']
      })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('mago-fmt-unformatted')
    })
  })
})
