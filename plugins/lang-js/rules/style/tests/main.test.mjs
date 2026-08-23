import { describe, expect, test } from 'vitest'
// `style/lint/main.mjs` (read-only detector) видалено — концерн портовано в
// native wasm-плагін (`crates/plugin-lang-js/src/lib.rs`, `detect_style_lint`).
// `filterStyleFiles` лишається лише у T0-фіксер `fix-lint.mjs` (самодостатній
// після видалення `main.mjs`), тож цей тест тепер імпортує звідти.
import { filterStyleFiles } from '../lint/fix-lint.mjs'

describe('filterStyleFiles', () => {
  test('лишає css/scss/vue', () => {
    expect(filterStyleFiles(['a.css', 'b.scss', 'c.vue', 'd.js'])).toEqual(['a.css', 'b.scss', 'c.vue'])
  })
})
