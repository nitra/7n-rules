import { describe, expect, test } from 'vitest'
import { filterStyleFiles } from '../../main.mjs'

describe('filterStyleFiles', () => {
  test('лишає css/scss/vue', () => {
    expect(filterStyleFiles(['a.css', 'b.scss', 'c.vue', 'd.js'])).toEqual(['a.css', 'b.scss', 'c.vue'])
  })
})
