/**
 * Тести check-adr.mjs: перевірка ADR Stop-hook (capture-decisions.sh) у Claude Code.
 *
 * `withTmpCwd` створює тимчасовий cwd; усі шляхи у check обчислюються відносно нього.
 * Канонічний bundled-скрипт читається з реального пакета (`npm/.claude-template/hooks/`),
 * тому перші тести копіюють його у tmp `.claude/hooks/` для збігу байт-у-байт.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { check } from './check.mjs'
import { ensureDir, withTmpCwd, writeJson } from '../../../scripts/utils/test-helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLED_HOOK_SOURCE = join(here, '..', '.claude-template', 'hooks', 'capture-decisions.sh')

/** Канонічний вміст hook-скрипта з пакета — спільне джерело правди для тестів. */
const bundledHookContent = await readFile(BUNDLED_HOOK_SOURCE, 'utf8')

/**
 * Канонічний валідний `.claude/settings.json` із обома managed-групами (lint + ADR).
 * @returns {Record<string, unknown>} settings-обʼєкт для запису
 */
function makeValidSettings() {
  return {
    hooks: {
      Stop: [
        { matcher: '', hooks: [{ type: 'command', command: 'npx --no @nitra/cursor stop-hook', timeout: 60 }] },
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/capture-decisions.sh"',
              async: true,
              timeout: 180
            }
          ]
        }
      ]
    }
  }
}

/**
 * Готує project-tree з усіма артефактами правила (для happy-path).
 * @returns {Promise<void>}
 */
async function setupValidProject() {
  await ensureDir('.claude/hooks')
  await writeFile('.claude/hooks/capture-decisions.sh', bundledHookContent, 'utf8')
  await writeJson('.claude/settings.json', makeValidSettings())
  await writeFile('.gitignore', 'node_modules/\n.claude/hooks/capture-decisions.log\n', 'utf8')
}

describe('check-adr (інтеграція)', () => {
  test('0 — повний валідний setup', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      expect(await check()).toBe(0)
    })
  })

  test('1 — немає .claude/hooks/capture-decisions.sh', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await mkdir('.claude/hooks', { recursive: true })
      await writeFile('.gitignore', '.claude/hooks/capture-decisions.log\n', 'utf8')
      // прибираємо скрипт
      await writeFile('.claude/hooks/capture-decisions.sh', '', 'utf8') // зробимо його не канонічним
      expect(await check()).toBe(1)
    })
  })

  // Перевірки структури `.claude/settings.json` (наявність Stop-hook з
  // `capture-decisions.sh`) і дубля у `.claude/settings.local.json` тепер у Rego
  // (`npm/policy/adr/settings_json/`, `npm/policy/adr/settings_local_json/`).
  // JS-перевірка лише наявність файлу.

  test('1 — .gitignore не покриває capture-decisions.log', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('0 — `.gitignore` через широкий glob `*.log` теж проходить', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeFile('.gitignore', 'node_modules/\n*.log\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('0 — `.claude/settings.local.json` без ADR-hook не вважається дублем', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeJson('.claude/settings.local.json', { permissions: { allow: ['Bash'] } })
      expect(await check()).toBe(0)
    })
  })
})
