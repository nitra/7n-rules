/**
 * Тести спільного T0-writer'а `createTemplateFixPattern`: JSON deep-merge, YAML
 * deep-merge (workflow-кроки за структурним збігом), create-if-missing, idempotency.
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTemplateFixPattern } from '../fix/template-deep-merge.mjs'

/**
 * @param {(dir: string) => unknown} fn тіло тесту, отримує шлях до temp-каталогу (може бути async)
 * @returns {Promise<unknown>} результат `fn`
 */
async function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'tdm-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * @param {string} concernDir абсолютний шлях до concern-теки (де лежить `template/`)
 * @param {string} snippetName basename snippet-файлу (напр. `settings.json.snippet.json`)
 * @param {string} content вміст snippet-файлу
 * @returns {void}
 */
function writeSnippet(concernDir, snippetName, content) {
  const tplDir = join(concernDir, 'template')
  mkdirSync(tplDir, { recursive: true })
  writeFileSync(join(tplDir, snippetName), content, 'utf8')
}

/**
 * @param {string} targetPath posix-relative шлях цільового файлу
 * @returns {object[]} мінімальний масив violations, що матчить `test()` патерну
 */
function violationsFor(targetPath) {
  return [{ ruleId: 'x', concernId: 'y', reason: 'policy-template-mismatch', message: 'x', file: targetPath }]
}

describe('createTemplateFixPattern — JSON', () => {
  test('файл відсутній → створюється зі snippet', () =>
    withTmp(async dir => {
      const concernDir = join(dir, 'concern')
      writeSnippet(concernDir, 'settings.json.snippet.json', JSON.stringify({ 'search.exclude': { a: true } }))
      const p = createTemplateFixPattern({ id: 't', targetPath: '.vscode/settings.json' })
      const violations = violationsFor('.vscode/settings.json')
      expect(p.test(violations)).toBe(true)
      const res = await p.apply(violations, { cwd: dir, concernDir })
      expect(res.touchedFiles).toHaveLength(1)
      const written = JSON.parse(readFileSync(join(dir, '.vscode/settings.json'), 'utf8'))
      expect(written).toEqual({ 'search.exclude': { a: true } })
    }))

  test('файл є, полю бракує потрібного значення → мердж додає, не ламає існуюче', () =>
    withTmp(async dir => {
      const concernDir = join(dir, 'concern')
      writeSnippet(
        concernDir,
        'settings.json.snippet.json',
        JSON.stringify({ 'search.exclude': { '**/.worktrees/**': true }, 'files.exclude': { '**/.worktrees/**': true } })
      )
      mkdirSync(join(dir, '.vscode'), { recursive: true })
      writeFileSync(
        join(dir, '.vscode/settings.json'),
        JSON.stringify({ 'search.exclude': { '**/custom/**': true }, 'editor.tabSize': 2 }, null, 2) + '\n',
        'utf8'
      )
      const p = createTemplateFixPattern({ id: 't', targetPath: '.vscode/settings.json' })
      const violations = violationsFor('.vscode/settings.json')
      const res = await p.apply(violations, { cwd: dir, concernDir })
      expect(res.touchedFiles).toHaveLength(1)
      const written = JSON.parse(readFileSync(join(dir, '.vscode/settings.json'), 'utf8'))
      expect(written).toEqual({
        'search.exclude': { '**/custom/**': true, '**/.worktrees/**': true },
        'files.exclude': { '**/.worktrees/**': true },
        'editor.tabSize': 2
      })
    }))

  test('вже відповідає snippet → без змін (idempotent)', () =>
    withTmp(async dir => {
      const concernDir = join(dir, 'concern')
      writeSnippet(concernDir, 'settings.json.snippet.json', JSON.stringify({ a: true }))
      mkdirSync(join(dir, '.vscode'), { recursive: true })
      writeFileSync(join(dir, '.vscode/settings.json'), JSON.stringify({ a: true }, null, 2) + '\n', 'utf8')
      const p = createTemplateFixPattern({ id: 't', targetPath: '.vscode/settings.json' })
      const res = await p.apply(violationsFor('.vscode/settings.json'), { cwd: dir, concernDir })
      expect(res.touchedFiles).toHaveLength(0)
    }))

  test('невалідний JSON у target → не чіпає (touchedFiles порожній)', () =>
    withTmp(async dir => {
      const concernDir = join(dir, 'concern')
      writeSnippet(concernDir, 'settings.json.snippet.json', JSON.stringify({ a: true }))
      mkdirSync(join(dir, '.vscode'), { recursive: true })
      writeFileSync(join(dir, '.vscode/settings.json'), '{ not valid json', 'utf8')
      const p = createTemplateFixPattern({ id: 't', targetPath: '.vscode/settings.json' })
      const res = await p.apply(violationsFor('.vscode/settings.json'), { cwd: dir, concernDir })
      expect(res.touchedFiles).toHaveLength(0)
    }))
})

describe('createTemplateFixPattern — YAML', () => {
  const SNIPPET = [
    'jobs:',
    '  release-publish:',
    '    steps:',
    '      - name: Release (bump + CHANGELOG + tag)',
    '        run: bunx n-rules release',
    ''
  ].join('\n')

  test('workflow-файл відсутній → створюється зі snippet as-is', () =>
    withTmp(async dir => {
      const concernDir = join(dir, 'concern')
      writeSnippet(concernDir, 'npm-publish.yml.snippet.yml', SNIPPET)
      const p = createTemplateFixPattern({ id: 't', targetPath: '.github/workflows/npm-publish.yml' })
      const res = await p.apply(violationsFor('.github/workflows/npm-publish.yml'), { cwd: dir, concernDir })
      expect(res.touchedFiles).toHaveLength(1)
      expect(readFileSync(join(dir, '.github/workflows/npm-publish.yml'), 'utf8')).toBe(SNIPPET)
    }))

  test('workflow-файл є, бракує кроку → дописує крок, зберігає коментарі й наявні кроки', () =>
    withTmp(async dir => {
      const concernDir = join(dir, 'concern')
      writeSnippet(concernDir, 'npm-publish.yml.snippet.yml', SNIPPET)
      mkdirSync(join(dir, '.github/workflows'), { recursive: true })
      const existing = [
        '# canonical workflow',
        'jobs:',
        '  release-publish:',
        '    steps:',
        '      - uses: actions/checkout@v6 # keep me',
        ''
      ].join('\n')
      writeFileSync(join(dir, '.github/workflows/npm-publish.yml'), existing, 'utf8')
      const p = createTemplateFixPattern({ id: 't', targetPath: '.github/workflows/npm-publish.yml' })
      const res = await p.apply(violationsFor('.github/workflows/npm-publish.yml'), { cwd: dir, concernDir })
      expect(res.touchedFiles).toHaveLength(1)
      const out = readFileSync(join(dir, '.github/workflows/npm-publish.yml'), 'utf8')
      expect(out).toContain('# canonical workflow')
      expect(out).toContain('uses: actions/checkout@v6 # keep me')
      expect(out).toContain('name: Release (bump + CHANGELOG + tag)')
      expect(out).toContain('run: bunx n-rules release')
    }))

  test('крок уже присутній → без змін (idempotent)', () =>
    withTmp(async dir => {
      const concernDir = join(dir, 'concern')
      writeSnippet(concernDir, 'npm-publish.yml.snippet.yml', SNIPPET)
      mkdirSync(join(dir, '.github/workflows'), { recursive: true })
      writeFileSync(join(dir, '.github/workflows/npm-publish.yml'), SNIPPET, 'utf8')
      const p = createTemplateFixPattern({ id: 't', targetPath: '.github/workflows/npm-publish.yml' })
      const res = await p.apply(violationsFor('.github/workflows/npm-publish.yml'), { cwd: dir, concernDir })
      expect(res.touchedFiles).toHaveLength(0)
    }))

  test('невалідний YAML у target → не чіпає', () =>
    withTmp(async dir => {
      const concernDir = join(dir, 'concern')
      writeSnippet(concernDir, 'npm-publish.yml.snippet.yml', SNIPPET)
      mkdirSync(join(dir, '.github/workflows'), { recursive: true })
      writeFileSync(join(dir, '.github/workflows/npm-publish.yml'), 'jobs: [unterminated', 'utf8')
      const p = createTemplateFixPattern({ id: 't', targetPath: '.github/workflows/npm-publish.yml' })
      const res = await p.apply(violationsFor('.github/workflows/npm-publish.yml'), { cwd: dir, concernDir })
      expect(res.touchedFiles).toHaveLength(0)
    }))
})

describe('createTemplateFixPattern — гейтинг', () => {
  test('test()=false, коли violations не про цей targetPath', () => {
    const p = createTemplateFixPattern({ id: 't', targetPath: '.vscode/settings.json' })
    expect(p.test(violationsFor('other/file.json'))).toBe(false)
  })

  test('snippet-файл відсутній у template/ → apply нічого не робить', () =>
    withTmp(async dir => {
      const concernDir = join(dir, 'concern')
      mkdirSync(join(concernDir, 'template'), { recursive: true })
      const p = createTemplateFixPattern({ id: 't', targetPath: '.vscode/settings.json' })
      const res = await p.apply(violationsFor('.vscode/settings.json'), { cwd: dir, concernDir })
      expect(res.touchedFiles).toHaveLength(0)
    }))
})
