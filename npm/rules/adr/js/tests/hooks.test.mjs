/**
 * Тести rules/adr/check.mjs: перевірка ADR Stop-hook (capture-decisions.sh) у Claude Code.
 *
 * `withTmpDir` створює тимчасовий каталог; усі шляхи у check обчислюються відносно нього
 * через явно переданий `cwd` параметр (без `process.chdir`).
 * Канонічний bundled-скрипт читається з реального пакета (`npm/.claude-template/hooks/`),
 * тому перші тести копіюють його у tmp `.claude/hooks/` для збігу байт-у-байт.
 */
import { describe, expect, test } from 'vitest'
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { env, platform } from 'node:process'
import { fileURLToPath } from 'node:url'

import { check } from '../hooks.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

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
 * @param {string} dir абсолютний шлях тимчасового каталогу
 * @returns {Promise<void>}
 */
async function setupValidProject(dir) {
  await ensureDir(join(dir, '.claude/hooks'))
  await ensureDir(join(dir, '.cursor'))
  await writeFile(join(dir, '.claude/hooks/capture-decisions.sh'), bundledCaptureContent, 'utf8')
  await writeFile(join(dir, '.claude/hooks/normalize-decisions.sh'), bundledNormalizeContent, 'utf8')
  await writeJson(join(dir, '.claude/settings.json'), makeValidSettings())
  await writeJson(join(dir, '.cursor/hooks.json'), {
    version: 1,
    hooks: {
      stop: [
        { command: 'bash "$PWD/.claude/hooks/capture-decisions.sh"', timeout: 180 },
        { command: 'bash "$PWD/.claude/hooks/normalize-decisions.sh"', timeout: 600 }
      ]
    }
  })
  await writeFile(
    join(dir, '.gitignore'),
    'node_modules/\n.claude/hooks/capture-decisions.log\n.claude/hooks/normalize-decisions.log\n',
    'utf8'
  )
}

describe('check-adr (інтеграція)', () => {
  test('0 — повний валідний setup', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      expect(await check(dir)).toBe(0)
    })
  })

  test('1 — capture-decisions.sh не канонічний', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeFile(join(dir, '.claude/hooks/capture-decisions.sh'), '', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — normalize-decisions.sh не канонічний', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeFile(join(dir, '.claude/hooks/normalize-decisions.sh'), '', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  // Перевірки структури `.claude/settings.json` (наявність Stop-хуків з
  // `capture-decisions.sh` і `normalize-decisions.sh`) і дублів у `.claude/settings.local.json`
  // — у Rego (`npm/rules/adr/policy/settings_json/`, `settings_local_json/`). JS-перевірка
  // лише наявність файлу.

  test('1 — .cursor/hooks.json не має Cursor stop-hook для capture', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeJson(join(dir, '.cursor/hooks.json'), {
        version: 1,
        hooks: { stop: [{ command: 'bash "$PWD/.claude/hooks/normalize-decisions.sh"' }] }
      })
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — .gitignore не покриває capture-decisions.log', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.claude/hooks/normalize-decisions.log\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — .gitignore не покриває normalize-decisions.log', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.claude/hooks/capture-decisions.log\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('0 — `.gitignore` через широкий glob `*.log` теж проходить', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n*.log\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('0 — `.gitignore` через `.claude/hooks/*.log` покриває обидва логи', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.claude/hooks/*.log\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('0 — `.claude/settings.local.json` без ADR-хуків не вважається дублем', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeJson(join(dir, '.claude/settings.local.json'), { permissions: { allow: ['Bash'] } })
      expect(await check(dir)).toBe(0)
    })
  })

  test('1 — capture-decisions.sh не існує (lines 96-97)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await rm(join(dir, '.claude/hooks/capture-decisions.sh'))
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — .claude/settings.json не існує (line 124)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await rm(join(dir, '.claude/settings.json'))
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — .cursor/hooks.json не існує (lines 178-179)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await rm(join(dir, '.cursor/hooks.json'))
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — .cursor/hooks.json є невалідним JSON (lines 183-184)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeFile(join(dir, '.cursor/hooks.json'), '{ invalid json }', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — .gitignore не існує (lines 227-228, 230)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await rm(join(dir, '.gitignore'))
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — hooks.json є масивом [] → cursorConfigHasStopHook повертає false (line 149)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeFile(join(dir, '.cursor/hooks.json'), '[]', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — hooks.json.hooks є масивом → line 153 (return false)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeJson(join(dir, '.cursor/hooks.json'), { hooks: [] })
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — hooks.json.hooks.stop не масив → line 157 (return false)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeJson(join(dir, '.cursor/hooks.json'), { hooks: { stop: null } })
      expect(await check(dir)).toBe(1)
    })
  })

  test('1 — hooks.json.hooks.stop містить null-елемент → line 161 (return false в some)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      await writeJson(join(dir, '.cursor/hooks.json'), { hooks: { stop: [null] } })
      expect(await check(dir)).toBe(1)
    })
  })
})

/**
 * Запускає тестовий код із маніпульованим PATH (тільки один бінарник у tmpDir).
 * @param {'claude'|'cursor-agent'|'both'|'none'} present який бінарник присутній у stub-PATH
 * @param {(binDir: string) => Promise<void>} fn тестовий код, що очікує підготований PATH
 * @returns {Promise<void>}
 */
async function withSingleBinPath(present, fn) {
  await withTmpDir(async binDir => {
    const isWin = platform === 'win32'
    const mkStub = async name => {
      const stub = join(binDir, isWin ? `${name}.exe` : name)
      await writeFile(stub, isWin ? '@echo off\n' : '#!/bin/sh\n', 'utf8')
      if (!isWin) await chmod(stub, 0o755)
    }
    if (present === 'claude' || present === 'both') await mkStub('claude')
    if (present === 'cursor-agent' || present === 'both') await mkStub('cursor-agent')
    const prevPath = env.PATH
    env.PATH = binDir
    try {
      await fn(binDir)
    } finally {
      if (prevPath === undefined) delete env.PATH
      else env.PATH = prevPath
    }
  })
}

describe('checkLlmCliAvailable — PATH scenarios', () => {
  test('isBinaryInPath повертає false коли PATH порожній (line 247)', async () => {
    await withTmpDir(async dir => {
      await setupValidProject(dir)
      const prevPath = env.PATH
      env.PATH = ''
      try {
        const code = await check(dir)
        expect(code).toBe(0)
      } finally {
        if (prevPath === undefined) delete env.PATH
        else env.PATH = prevPath
      }
    })
  })

  test('hasClaude && !hasCursor → повідомлення про відсутній cursor-agent (lines 270-271)', async () => {
    await withSingleBinPath('claude', async () => {
      await withTmpDir(async dir => {
        await setupValidProject(dir)
        const code = await check(dir)
        expect(code).toBe(0)
      })
    })
  })

  test('!hasClaude && hasCursor → повідомлення про відсутній claude (lines 272-273)', async () => {
    await withSingleBinPath('cursor-agent', async () => {
      await withTmpDir(async dir => {
        await setupValidProject(dir)
        const code = await check(dir)
        expect(code).toBe(0)
      })
    })
  })

  test('обидва відсутні → info-повідомлення без fail (line 275)', async () => {
    await withSingleBinPath('none', async () => {
      await withTmpDir(async dir => {
        await setupValidProject(dir)
        const code = await check(dir)
        expect(code).toBe(0)
      })
    })
  })
})
