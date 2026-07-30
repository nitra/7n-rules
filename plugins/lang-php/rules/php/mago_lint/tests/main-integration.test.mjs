/**
 * Integration-тести detector-а `php/mago_lint`: реальний `mago` (жодних моків
 * `ensureToolAsync`/`spawnAsync`) на tmp-фікстурі. `describe.skipIf(!hasMago)` — пропускає
 * весь файл, якщо `mago` не резолвиться в PATH (патерн `k8s/hasura_configmap`/`hasConftest`).
 * Перший тест піднімає timeout до 30s — cold-cache `ensureToolAsync` (патерн
 * `opa_check/tests/main.test.mjs`).
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

import { lint } from '../main.mjs'

const hasMago = Boolean(resolveCmd('mago'))

const CLEAN_PHP = `<?php

declare(strict_types=1);

function add(int $a, int $b): int
{
    return $a + $b;
}
`

const SYNTAX_ERROR_PHP = `<?php
function broken( {
    return 1;
`

describe.skipIf(!hasMago)('php/mago_lint detector — real mago', () => {
  test('чистий файл → без порушень (рівня error)', { timeout: 30_000 }, async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await writeFile(join(dir, 'Clean.php'), CLEAN_PHP, 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_lint', files: ['Clean.php'] })
      expect(violations).toHaveLength(0)
    })
  })

  test('синтаксична помилка → mago-lint (parse error, рівень error)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
      await writeFile(join(dir, 'Broken.php'), SYNTAX_ERROR_PHP, 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_lint', files: ['Broken.php'] })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('mago-lint')
    })
  })
})
