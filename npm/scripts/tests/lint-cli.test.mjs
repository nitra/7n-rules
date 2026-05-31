import { describe, expect, test } from 'vitest'

import { selectLintRules } from '../lint-cli.mjs'

const META = {
  'js-lint': { lint: 'quick' },
  'js-lint-ci': { lint: 'ci' },
  'style-lint': { lint: 'quick' },
  ga: { lint: 'ci' },
  adr: {}
}

describe('selectLintRules', () => {
  test('quick → лише quick-правила, алфавітно', () => {
    expect(selectLintRules(META, 'quick')).toEqual(['js-lint', 'style-lint'])
  })
  test('ci → quick + ci, алфавітно', () => {
    expect(selectLintRules(META, 'ci')).toEqual(['ga', 'js-lint', 'js-lint-ci', 'style-lint'])
  })
})
