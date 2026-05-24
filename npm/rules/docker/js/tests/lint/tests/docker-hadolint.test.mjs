/**
 * Тести шляхів hadolint (`posixRel`); виклик hadolint/docker не перевіряється (залежність від середовища).
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { HADOLINT_IMAGE, posixRel } from '../../../../lib/docker-hadolint.mjs'

const HADOLINT_IMAGE_RE = /^hadolint\/hadolint:v[\d.]+$/

describe('docker-hadolint', () => {
  test('posixRel дає слеші як у POSIX', () => {
    const root = '/proj'
    const abs = join('/proj', 'docker', 'Dockerfile')
    const rel = posixRel(root, abs)
    expect(rel).not.toContain('\\')
    expect(rel).toBe('docker/Dockerfile')
  })

  test('константа образу hadolint зафіксована', () => {
    expect(HADOLINT_IMAGE).toMatch(HADOLINT_IMAGE_RE)
  })
})
