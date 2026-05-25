/**
 * Тести `ensureGitignoreEntries`: idempotent append-only оновлювач .gitignore.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ensureGitignoreEntries } from '../ensure-gitignore-entries.mjs'

describe('ensureGitignoreEntries', () => {
  test('створює .gitignore коли файлу немає', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitignore-create-'))
    const { added } = await ensureGitignoreEntries(dir, ['**/foo/', '**/bar/'], 'Test section')
    expect(added).toEqual(['**/foo/', '**/bar/'])
    const content = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(content).toContain('# Test section')
    expect(content).toContain('**/foo/')
    expect(content).toContain('**/bar/')
    rmSync(dir, { recursive: true, force: true })
  })

  test('idempotent — нічого не дописує якщо всі entries вже є', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitignore-idempotent-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n**/foo/\n**/bar/\n')
    const { added } = await ensureGitignoreEntries(dir, ['**/foo/', '**/bar/'], 'Test')
    expect(added).toEqual([])
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('node_modules/\n**/foo/\n**/bar/\n')
    rmSync(dir, { recursive: true, force: true })
  })

  test('partial — дописує тільки відсутні entries під header', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitignore-partial-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n**/foo/\n')
    const { added } = await ensureGitignoreEntries(dir, ['**/foo/', '**/bar/', '**/baz/'], 'Test')
    expect(added).toEqual(['**/bar/', '**/baz/'])
    const content = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('**/foo/')
    expect(content).toContain('# Test')
    expect(content).toContain('**/bar/')
    expect(content).toContain('**/baz/')
    rmSync(dir, { recursive: true, force: true })
  })

  test('зберігає trailing-newline (не подвоює)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitignore-newline-'))
    writeFileSync(join(dir, '.gitignore'), 'a\n')
    await ensureGitignoreEntries(dir, ['b'], 'X')
    const content = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(content).not.toContain('\n\n\n')
    expect(content.endsWith('\n')).toBe(true)
    expect(content).toContain('a\n')
    expect(content).toContain('b\n')
    rmSync(dir, { recursive: true, force: true })
  })

  test('обробляє файл без trailing-newline — додає роздільник', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitignore-no-newline-'))
    writeFileSync(join(dir, '.gitignore'), 'a')
    await ensureGitignoreEntries(dir, ['b'], 'X')
    const content = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(content).toContain('a\n')
    expect(content).toContain('b\n')
    rmSync(dir, { recursive: true, force: true })
  })
})
