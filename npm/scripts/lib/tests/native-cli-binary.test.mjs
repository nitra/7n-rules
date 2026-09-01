/**
 * Резолвінг бінаря `rules-cli` (`lib/native-cli-binary.mjs`) — порядок
 * пошуку (env-override → вихідне дерево → встановлений канал → гучна
 * помилка) на ін'єктованих deps, без реального `fs`/мережі. Той самий
 * прийом, що `native.test.mjs` для napi-аддона.
 *
 * Задача: канал доставки native-бінаря
 * (`docs/specs/2026-09-01-native-binary-distribution-channel.md`).
 */

import { describe, expect, test } from 'vitest'

import {
  SUPPORTED_CLI_TARGETS,
  nativeCliBinaryChain,
  resolveNativeCliBinary
} from '../native-cli-binary.mjs'

/**
 * Базові deps: підтримувана платформа, нічого не збудовано й не наповнено.
 * @param {Record<string, unknown>} [overrides] точкові заміни полів
 * @returns {Record<string, unknown>} deps для резолвера
 */
function baseDeps(overrides = {}) {
  return {
    env: {},
    platform: 'darwin',
    arch: 'arm64',
    existsSync: () => false,
    repoRoot: '/repo',
    ...overrides
  }
}

/**
 * existsSync, що бачить лише перелічені шляхи.
 * @param {string[]} present наявні шляхи
 * @returns {(p: string) => boolean} предикат
 */
function only(present) {
  return p => present.includes(p)
}

describe('SUPPORTED_CLI_TARGETS', () => {
  test('дзеркалить трійку napi-матриці build-native (без win32-arm64 тощо)', () => {
    expect([...SUPPORTED_CLI_TARGETS].sort()).toEqual(['darwin-arm64', 'linux-x64', 'win32-x64'])
  })
})

describe('nativeCliBinaryChain (порядок пошуку)', () => {
  test('N_RULES_CLI_BIN має найвищий пріоритет і довіряється без перевірки існування', () => {
    const chain = nativeCliBinaryChain(baseDeps({ env: { N_RULES_CLI_BIN: '/custom/rules-cli' } }))
    expect(chain).toEqual(['/custom/rules-cli'])
  })

  test('override перекриває навіть наявну локальну збірку', () => {
    const chain = nativeCliBinaryChain(
      baseDeps({
        env: { N_RULES_CLI_BIN: '/custom/rules-cli' },
        existsSync: only(['/repo/crates/rules-cli/Cargo.toml', '/repo/target/release/rules-cli'])
      })
    )
    expect(chain).toEqual(['/custom/rules-cli'])
  })

  test('вихідне дерево: release-збірка перед debug', () => {
    const chain = nativeCliBinaryChain(
      baseDeps({
        existsSync: only([
          '/repo/crates/rules-cli/Cargo.toml',
          '/repo/target/release/rules-cli',
          '/repo/target/debug/rules-cli'
        ])
      })
    )
    expect(chain).toEqual(['/repo/target/release/rules-cli', '/repo/target/debug/rules-cli'])
  })

  test('вихідне дерево, лише debug зібрано', () => {
    const chain = nativeCliBinaryChain(
      baseDeps({
        existsSync: only(['/repo/crates/rules-cli/Cargo.toml', '/repo/target/debug/rules-cli'])
      })
    )
    expect(chain).toEqual(['/repo/target/debug/rules-cli'])
  })

  test('win32: ім\'я бінаря з .exe', () => {
    const chain = nativeCliBinaryChain(
      baseDeps({
        platform: 'win32',
        arch: 'x64',
        existsSync: only(['/repo/crates/rules-cli/Cargo.toml', '/repo/target/release/rules-cli.exe'])
      })
    )
    expect(chain).toEqual(['/repo/target/release/rules-cli.exe'])
  })

  test('НЕ вихідне дерево (встановлений пакет): локальна збірка ігнорується навіть якщо файл лежить поруч', () => {
    const chain = nativeCliBinaryChain(
      baseDeps({
        existsSync: only(['/repo/target/release/rules-cli']) // Cargo.toml відсутній — не вихідне дерево
      })
    )
    expect(chain).toEqual([])
  })

  test('встановлений канал: підхоплюється, коли Cargo.toml немає (не вихідне дерево)', () => {
    const chain = nativeCliBinaryChain(
      baseDeps({
        existsSync: only(['/repo/.bin-cache/rules-cli-darwin-arm64'])
      })
    )
    expect(chain).toEqual(['/repo/.bin-cache/rules-cli-darwin-arm64'])
  })

  test('вихідне дерево: локальна збірка йде ПЕРЕД встановленим каналом', () => {
    const chain = nativeCliBinaryChain(
      baseDeps({
        existsSync: only([
          '/repo/crates/rules-cli/Cargo.toml',
          '/repo/target/release/rules-cli',
          '/repo/.bin-cache/rules-cli-darwin-arm64'
        ])
      })
    )
    expect(chain).toEqual(['/repo/target/release/rules-cli', '/repo/.bin-cache/rules-cli-darwin-arm64'])
  })

  test('непідтримувана платформа: встановлений канал не перевіряється взагалі', () => {
    const chain = nativeCliBinaryChain(
      baseDeps({
        platform: 'win32',
        arch: 'arm64', // win32-arm64 поза SUPPORTED_CLI_TARGETS
        existsSync: only(['/repo/.bin-cache/rules-cli-win32-arm64.exe'])
      })
    )
    expect(chain).toEqual([])
  })

  test('нічого не знайдено — порожній ланцюг', () => {
    expect(nativeCliBinaryChain(baseDeps())).toEqual([])
  })
})

describe('resolveNativeCliBinary', () => {
  test('повертає перший кандидат ланцюга', () => {
    const p = resolveNativeCliBinary(
      baseDeps({
        existsSync: only(['/repo/crates/rules-cli/Cargo.toml', '/repo/target/release/rules-cli'])
      })
    )
    expect(p).toBe('/repo/target/release/rules-cli')
  })

  test('непідтримувана платформа без override — окрема гучна помилка з переліком трійок', () => {
    expect(() => resolveNativeCliBinary(baseDeps({ platform: 'win32', arch: 'arm64' }))).toThrow(
      /win32-arm64.*поза каналом.*darwin-arm64.*linux-x64.*win32-x64/s
    )
  })

  test('підтримувана платформа, нічого не зібрано — інша гучна помилка (не "поза каналом")', () => {
    expect(() => resolveNativeCliBinary(baseDeps())).toThrow(
      /rules-cli binary: немає збірки для "darwin-arm64"/
    )
  })

  test('помилка "немає збірки" підказує N_RULES_CLI_BIN і cargo build', () => {
    try {
      resolveNativeCliBinary(baseDeps())
      throw new Error('очікував виняток, але виклик пройшов успішно')
    } catch (error) {
      expect(error.message).toContain('N_RULES_CLI_BIN')
      expect(error.message).toContain('cargo build --release -p rules-cli')
    }
  })

  test('ніколи не повертає мовчазний JS-fallback (bin/n-rules.js) — лише кидає', () => {
    expect(() => resolveNativeCliBinary(baseDeps({ platform: 'freebsd', arch: 'x64' }))).toThrow()
  })
})
