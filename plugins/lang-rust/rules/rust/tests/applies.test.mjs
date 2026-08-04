/**
 * Тести rule-level гейта правила `rust`. Гейт декларативний
 * (`rust/main.json:applies`), тож тест обчислює САМЕ ТОЙ предикат, який
 * лежить у пакеті, — а не окрему тестову копію.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { evaluateAppliesNode, readRuleApplies } from '@7n/rules/scripts/lib/rule-applies.mjs'

import { lint } from '../applies/main.mjs'
import { RUST_WALK_IGNORED_DIR_NAMES } from '../lib/ignored-dirs.mjs'

const RULE_DIR = fileURLToPath(new URL('../', import.meta.url))

/** @returns {string} абсолютний шлях тимчасового кореня */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'rust-applies-'))
}

/**
 * @param {string} cwd корінь тимчасового репо
 * @returns {boolean} вердикт гейта з пакета
 */
function applies(cwd) {
  const spec = readRuleApplies(RULE_DIR)
  expect(spec.kind).toBe('declarative')
  return evaluateAppliesNode(spec.node, cwd)
}

/**
 * @param {string} root корінь
 * @param {string} relative відносний posix-шлях файлу
 */
function touch(root, relative) {
  const segments = relative.split('/')
  const name = segments.pop()
  if (segments.length > 0) mkdirSync(join(root, ...segments), { recursive: true })
  writeFileSync(join(root, ...segments, /** @type {string} */ (name)), '[package]\nname="x"\n')
}

describe('rust applies', () => {
  test('гейт правила — декларативний globMatches, без виконуваного модуля', () => {
    const spec = readRuleApplies(RULE_DIR)
    expect(spec.kind).toBe('declarative')
    expect(spec.node.globMatches.glob).toEqual(['**/Cargo.toml'])
  })

  /**
   * Ризик, названий у §5 мінідизайну контракту v3.1: ignore-список гейта —
   * ДРУГА копія `RUST_WALK_IGNORED_DIR_NAMES` (гейт мусить читатися як дані,
   * без виконання JS). Розбіжність копій = правило `rust` тихо вмикається в
   * чужих worktree.
   */
  test('ignoreDirs гейта збігається з RUST_WALK_IGNORED_DIR_NAMES', () => {
    const spec = readRuleApplies(RULE_DIR)
    expect(new Set(spec.node.globMatches.ignoreDirs)).toEqual(RUST_WALK_IGNORED_DIR_NAMES)
  })

  test('true коли Cargo.toml у cwd', () => {
    const root = makeRoot()
    try {
      touch(root, 'Cargo.toml')
      expect(applies(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('true коли Cargo.toml у src-tauri/', () => {
    const root = makeRoot()
    try {
      touch(root, 'src-tauri/Cargo.toml')
      expect(applies(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('false коли немає Cargo.toml', () => {
    const root = makeRoot()
    try {
      writeFileSync(join(root, 'package.json'), '{}')
      expect(applies(root)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test.each([...RUST_WALK_IGNORED_DIR_NAMES])('false коли Cargo.toml лише під %s/', ignored => {
    const root = makeRoot()
    try {
      touch(root, `${ignored}/copy/Cargo.toml`)
      expect(applies(root)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('rust check', () => {
  test('lint() завжди чистий (лише context-pass)', async () => {
    const ctx = { cwd: process.cwd(), ruleId: 'rust', concernId: 'applies', files: undefined }
    const result = await lint(ctx)
    expect(result.violations).toEqual([])
  })
})
