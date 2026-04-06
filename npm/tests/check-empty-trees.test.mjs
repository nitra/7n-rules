/**
 * Тести check-docker і check-k8s у дереві без відповідних файлів (ранній вихід 0).
 */
import { describe, expect, test } from 'bun:test'

import { check as checkDocker } from '../scripts/check-docker.mjs'
import { check as checkK8s } from '../scripts/check-k8s.mjs'
import { withTmpCwd } from './helpers.mjs'

describe('check без цільових файлів', () => {
  test('check-docker — 0, якщо немає Dockerfile', async () => {
    await withTmpCwd(async () => {
      expect(await checkDocker()).toBe(0)
    })
  })

  test('check-k8s — 0, якщо немає yaml під k8s', async () => {
    await withTmpCwd(async () => {
      expect(await checkK8s()).toBe(0)
    })
  })
})
