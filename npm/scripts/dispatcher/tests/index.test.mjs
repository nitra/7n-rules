/**
 * Тести маршрутизації CLI (`bin/n-cursor.js`): flow, graph, watch, mt — невідомі команди.
 *
 * Перевіряємо:
 *  - `flow`, `graph`, `watch`, `mt` → unknown command (exit 1)
 *  - help output не містить цих команд у списку
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const binPath = join(dirname(fileURLToPath(import.meta.url)), '../../../bin/n-cursor.js')

const ADR_HOOKS_SKIP_RE = /ADR_HOOKS_SKIP\s*=\s*['"]1['"]/
const SWITCH_COMMAND_RE = /switch\s*\(\s*command\s*\)/

const RE_UNKNOWN_COMMAND = /невідома команда|unknown/i
const RE_WORD_FLOW = /\bflow\b/
const RE_WORD_GRAPH = /\bgraph\b/
const RE_WORD_WATCH = /\bwatch\b/

/**
 * Запускає n-cursor з даними аргументами і повертає {status, stderr, stdout}.
 * @param {string[]} args CLI-аргументи після імені бінарника
 * @returns {{ status: number, stderr: string, stdout: string }} код виходу і потоки виводу
 */
function runCli(args) {
  const result = spawnSync('bun', [binPath, ...args], { encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? ''
  }
}

describe('видалені команди — flow, graph, watch, mt', () => {
  test('flow → невідома команда, exit 1', () => {
    const { status, stderr } = runCli(['flow'])
    expect(status).toBe(1)
    expect(stderr).toMatch(RE_UNKNOWN_COMMAND)
  })

  test('graph → невідома команда, exit 1', () => {
    const { status, stderr } = runCli(['graph'])
    expect(status).toBe(1)
    expect(stderr).toMatch(RE_UNKNOWN_COMMAND)
  })

  test('watch → невідома команда, exit 1', () => {
    const { status, stderr } = runCli(['watch'])
    expect(status).toBe(1)
    expect(stderr).toMatch(RE_UNKNOWN_COMMAND)
  })

  test('mt → невідома команда, exit 1', () => {
    const { status, stderr } = runCli(['mt'])
    expect(status).toBe(1)
    expect(stderr).toMatch(RE_UNKNOWN_COMMAND)
  })

  test('help output не містить flow', () => {
    const { stderr } = runCli(['bogus-cmd-to-trigger-help'])
    // Список допустимих команд — у stderr після "Очікується:"
    const after = stderr.split('Очікується:', 2)[1] ?? stderr
    expect(after).not.toMatch(RE_WORD_FLOW)
  })

  test('help output не містить graph', () => {
    const { stderr } = runCli(['bogus-cmd-to-trigger-help'])
    const after = stderr.split('Очікується:', 2)[1] ?? stderr
    expect(after).not.toMatch(RE_WORD_GRAPH)
  })

  test('help output не містить watch', () => {
    const { stderr } = runCli(['bogus-cmd-to-trigger-help'])
    const after = stderr.split('Очікується:', 2)[1] ?? stderr
    expect(after).not.toMatch(RE_WORD_WATCH)
  })
})

describe('ADR_HOOKS_SKIP (spec 2026-06-30)', () => {
  test('виставляється ДО switch (command) — покриває всі підкоманди-оркестратори без пер-case дублювання', async () => {
    const src = await readFile(binPath, 'utf8')
    const skipIdx = src.search(ADR_HOOKS_SKIP_RE)
    const switchIdx = src.search(SWITCH_COMMAND_RE)
    expect(skipIdx).toBeGreaterThan(-1)
    expect(switchIdx).toBeGreaterThan(-1)
    expect(skipIdx).toBeLessThan(switchIdx)
  })
})
