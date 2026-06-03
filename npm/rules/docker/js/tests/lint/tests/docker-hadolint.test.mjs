/**
 * Тести шляхів hadolint (`posixRel`); виклик hadolint не перевіряється (залежність від середовища).
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'

import { posixRel } from '../../../../lib/docker-hadolint.mjs'

describe('docker-hadolint', () => {
  test('posixRel дає слеші як у POSIX', () => {
    const root = '/proj'
    const abs = join('/proj', 'docker', 'Dockerfile')
    const rel = posixRel(root, abs)
    expect(rel).not.toContain('\\')
    expect(rel).toBe('docker/Dockerfile')
  })
})
