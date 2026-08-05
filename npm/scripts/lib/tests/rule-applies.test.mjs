/**
 * Тести міні-DSL декларативного гейта `main.json:applies`.
 *
 * Дзеркало Rust-набору в `crates/rules-core/src/rule_applies.rs` — обидва боки
 * мусять давати той самий вердикт на тих самих фікстурах, інакше `ci plan`/
 * `lint` розійшлись би мовчки.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  AppliesSpecError,
  evaluateAppliesNode,
  parseAppliesNode,
  parseAppliesSpec,
  readRuleApplies
} from '../rule-applies.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

/** Ignore-список гейта `rust` — той самий, що в `plugins/lang-rust/.../ignored-dirs.mjs`. */
const RUST_IGNORE = [
  'node_modules',
  '.git',
  'target',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '.claude',
  'vendor',
  '.worktrees'
]

/** @type {import('../rule-applies.mjs').AppliesNode} */
const RUST_GATE = { globMatches: { glob: ['**/Cargo.toml'], ignoreDirs: RUST_IGNORE } }

/**
 * @param {string} root корінь
 * @param {string} relative відносний posix-шлях файлу
 */
function touch(root, relative) {
  const segments = relative.split('/')
  const name = segments.pop()
  if (segments.length > 0) mkdirSync(join(root, ...segments), { recursive: true })
  writeFileSync(join(root, ...segments, /** @type {string} */ (name)), '')
}

describe('parseAppliesSpec', () => {
  test('поля немає → always, "dynamic" → dynamic', () => {
    expect(parseAppliesSpec(undefined)).toEqual({ kind: 'always' })
    expect(parseAppliesSpec('dynamic')).toEqual({ kind: 'dynamic' })
  })

  test('усі чотири оператори словника парсяться', () => {
    const spec = parseAppliesSpec({
      any: [
        { pathExists: 'npm' },
        { globMatches: { glob: '**/Cargo.toml', ignoreDirs: ['target'] } },
        { jsonFieldContains: { file: 'package.json', field: 'workspaces', value: 'npm' } }
      ]
    })
    expect(spec.kind).toBe('declarative')
    expect(spec.node.any).toHaveLength(3)
    // glob нормалізується в масив незалежно від форми запису
    expect(spec.node.any[1].globMatches.glob).toEqual(['**/Cargo.toml'])
  })

  test('вузол із двома операторами — помилка, а не здогад', () => {
    expect(() => parseAppliesSpec({ pathExists: 'npm', any: [{ pathExists: 'x' }] })).toThrow(AppliesSpecError)
  })

  test('невідомий оператор називається в тексті помилки', () => {
    expect(() => parseAppliesSpec({ fileContains: 'npm' })).toThrow(/fileContains/u)
  })

  test('порожні any/glob відкидаються', () => {
    expect(() => parseAppliesSpec({ any: [] })).toThrow(AppliesSpecError)
    expect(() => parseAppliesSpec({ globMatches: { glob: [] } })).toThrow(AppliesSpecError)
  })

  test('шлях вузла потрапляє в текст помилки', () => {
    expect(() => parseAppliesNode({ any: [{ pathExists: 'ok' }, { pathExists: '' }] })).toThrow(/applies\.any\[1\]/u)
  })
})

describe('pathExists', () => {
  test('істина і для файлу, і для каталогу (дзеркало existsSync)', async () => {
    await withTmpDir(async dir => {
      mkdirSync(join(dir, 'npm'))
      touch(dir, 'pyproject.toml')
      expect(evaluateAppliesNode({ pathExists: 'npm' }, dir)).toBe(true)
      expect(evaluateAppliesNode({ pathExists: 'pyproject.toml' }, dir)).toBe(true)
      expect(evaluateAppliesNode({ pathExists: 'Cargo.toml' }, dir)).toBe(false)
    })
  })
})

describe('globMatches', () => {
  test('матчить файл у корені', async () => {
    await withTmpDir(async dir => {
      touch(dir, 'Cargo.toml')
      expect(evaluateAppliesNode(RUST_GATE, dir)).toBe(true)
    })
  })

  test('матчить файл у піддереві', async () => {
    await withTmpDir(async dir => {
      touch(dir, 'crates/rules-core/Cargo.toml')
      expect(evaluateAppliesNode(RUST_GATE, dir)).toBe(true)
    })
  })

  test.each(RUST_IGNORE)('не заходить у %s/', async ignored => {
    await withTmpDir(async dir => {
      touch(dir, `${ignored}/copy/Cargo.toml`)
      expect(evaluateAppliesNode(RUST_GATE, dir)).toBe(false)
    })
  })

  test('каталог з іменем як у патерні не рахується збігом', async () => {
    await withTmpDir(async dir => {
      mkdirSync(join(dir, 'Cargo.toml'))
      expect(evaluateAppliesNode(RUST_GATE, dir)).toBe(false)
    })
  })
})

describe('jsonFieldContains', () => {
  /** @type {import('../rule-applies.mjs').AppliesNode} */
  const node = { jsonFieldContains: { file: 'package.json', field: 'workspaces', value: 'npm' } }

  test('лише масив, що містить значення', async () => {
    await withTmpDir(async dir => {
      expect(evaluateAppliesNode(node, dir)).toBe(false)

      writeFileSync(join(dir, 'package.json'), '{"workspaces":["run/*"]}')
      expect(evaluateAppliesNode(node, dir)).toBe(false)

      writeFileSync(join(dir, 'package.json'), '{"workspaces":["run/*","npm"]}')
      expect(evaluateAppliesNode(node, dir)).toBe(true)

      // Об'єктна форма workspaces масивом не є — та сама перевірка Array.isArray
      writeFileSync(join(dir, 'package.json'), '{"workspaces":{"packages":["npm"]}}')
      expect(evaluateAppliesNode(node, dir)).toBe(false)
    })
  })

  test('битий JSON → false, не виняток', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package.json'), '{ битий json')
      expect(evaluateAppliesNode(node, dir)).toBe(false)
    })
  })

  test('шлях поля через крапку', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package.json'), '{"a":{"b":["x"]}}')
      expect(evaluateAppliesNode({ jsonFieldContains: { file: 'package.json', field: 'a.b', value: 'x' } }, dir)).toBe(
        true
      )
    })
  })
})

describe('readRuleApplies', () => {
  test('правило з JS-гейтом і без поля читається як dynamic (legacy-міст)', async () => {
    await withTmpDir(async dir => {
      mkdirSync(join(dir, 'applies'), { recursive: true })
      writeFileSync(join(dir, 'applies', 'main.mjs'), 'export function applies() { return true }')
      writeFileSync(join(dir, 'main.json'), '{ "auto": "завжди" }')
      expect(readRuleApplies(dir)).toEqual({ kind: 'dynamic' })
    })
  })

  test('правило без гейта — always', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'main.json'), '{ "auto": "завжди" }')
      expect(readRuleApplies(dir)).toEqual({ kind: 'always' })
    })
  })

  test('декларативне поле виграє над наявним applies/main.mjs', async () => {
    await withTmpDir(async dir => {
      mkdirSync(join(dir, 'applies'), { recursive: true })
      writeFileSync(join(dir, 'applies', 'main.mjs'), 'export function lint() {}')
      writeFileSync(join(dir, 'main.json'), '{ "applies": { "pathExists": "pyproject.toml" } }')
      expect(readRuleApplies(dir)).toEqual({ kind: 'declarative', node: { pathExists: 'pyproject.toml' } })
    })
  })

  test('битий предикат падає гучно, а не вимикає правило мовчки', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'main.json'), '{ "applies": { "nope": 1 } }')
      expect(() => readRuleApplies(dir)).toThrow(AppliesSpecError)
    })
  })
})
