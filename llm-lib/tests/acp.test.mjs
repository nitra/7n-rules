/**
 * Тонкий napi-клієнт `lib/acp.mjs`: `runAcpAgent` делегує в
 * `native.oneShotAcp` без власної протокольної логіки (інжект native).
 */

import { describe, expect, test } from 'vitest'

import { runAcpAgent } from '../lib/acp.mjs'

describe('runAcpAgent', () => {
  test('делегує kind/prompt/cwd у native.oneShotAcp і віддає його результат', async () => {
    const calls = []
    const native = {
      oneShotAcp: (kind, prompt, cwd) => {
        calls.push([kind, prompt, cwd])
        return Promise.resolve('відповідь')
      }
    }
    await expect(runAcpAgent('codex', 'зроби X', '/proj', { native })).resolves.toBe('відповідь')
    expect(calls).toEqual([['codex', 'зроби X', '/proj']])
  })
})
