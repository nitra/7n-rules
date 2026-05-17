/**
 * Тести check-adr.mjs: перевірка ADR Stop-hook (capture-decisions.sh) у Claude Code.
 *
 * `withTmpCwd` створює тимчасовий cwd; усі шляхи у check обчислюються відносно нього.
 * Канонічний bundled-скрипт читається з реального пакета (`npm/.claude-template/hooks/`),
 * тому перші тести копіюють його у tmp `.claude/hooks/` для збігу байт-у-байт.
 */
import { describe, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { check } from './check.mjs'
import { ensureDir, withTmpCwd, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLED_HOOKS_DIR = join(here, '..', '..', '..', '..', '.claude-template', 'hooks')

/** Канонічні вмісти hook-скриптів з пакета — спільне джерело правди для тестів. */
const bundledCaptureContent = await readFile(join(BUNDLED_HOOKS_DIR, 'capture-decisions.sh'), 'utf8')
const bundledNormalizeContent = await readFile(join(BUNDLED_HOOKS_DIR, 'normalize-decisions.sh'), 'utf8')

/**
 * Канонічний валідний `.claude/settings.json` із усіма managed-групами (lint + capture + normalize).
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
        },
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/normalize-decisions.sh"',
              async: true,
              timeout: 600
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
  await ensureDir('.cursor')
  await writeFile('.claude/hooks/capture-decisions.sh', bundledCaptureContent, 'utf8')
  await writeFile('.claude/hooks/normalize-decisions.sh', bundledNormalizeContent, 'utf8')
  await writeJson('.claude/settings.json', makeValidSettings())
  await writeJson('.cursor/hooks.json', {
    version: 1,
    hooks: {
      stop: [
        { command: 'bash "$PWD/.claude/hooks/capture-decisions.sh"', timeout: 180 },
        { command: 'bash "$PWD/.claude/hooks/normalize-decisions.sh"', timeout: 600 }
      ]
    }
  })
  await writeFile(
    '.gitignore',
    'node_modules/\n.claude/hooks/capture-decisions.log\n.claude/hooks/normalize-decisions.log\n',
    'utf8'
  )
}

describe('check-adr (інтеграція)', () => {
  test('0 — повний валідний setup', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      expect(await check()).toBe(0)
    })
  })

  test('1 — capture-decisions.sh не канонічний', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeFile('.claude/hooks/capture-decisions.sh', '', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('1 — normalize-decisions.sh не канонічний', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeFile('.claude/hooks/normalize-decisions.sh', '', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  // Перевірки структури `.claude/settings.json` (наявність Stop-хуків з
  // `capture-decisions.sh` і `normalize-decisions.sh`) і дублів у `.claude/settings.local.json`
  // — у Rego (`npm/rules/adr/policy/settings_json/`, `settings_local_json/`). JS-перевірка
  // лише наявність файлу.

  test('1 — .cursor/hooks.json не має Cursor stop-hook для capture', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeJson('.cursor/hooks.json', {
        version: 1,
        hooks: { stop: [{ command: 'bash "$PWD/.claude/hooks/normalize-decisions.sh"' }] }
      })
      expect(await check()).toBe(1)
    })
  })

  test('1 — .gitignore не покриває capture-decisions.log', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeFile('.gitignore', 'node_modules/\n.claude/hooks/normalize-decisions.log\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('1 — .gitignore не покриває normalize-decisions.log', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeFile('.gitignore', 'node_modules/\n.claude/hooks/capture-decisions.log\n', 'utf8')
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

  test('0 — `.gitignore` через `.claude/hooks/*.log` покриває обидва логи', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeFile('.gitignore', 'node_modules/\n.claude/hooks/*.log\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('0 — `.claude/settings.local.json` без ADR-хуків не вважається дублем', async () => {
    await withTmpCwd(async () => {
      await setupValidProject()
      await writeJson('.claude/settings.local.json', { permissions: { allow: ['Bash'] } })
      expect(await check()).toBe(0)
    })
  })
})
