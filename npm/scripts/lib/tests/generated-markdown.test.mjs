import { describe, expect, test } from 'vitest'

import {
  collapseMultipleBlankLines,
  expandMustacheSection,
  formatGeneratedMarkdownLines,
  renderAgentsTemplate
} from '../generated-markdown.mjs'

/** Три й більше послідовних переносів рядка (MD012). */
const TRIPLE_OR_MORE_NEWLINES = /\n\n\n/

describe('collapseMultipleBlankLines', () => {
  test('згортає три і більше переносів до одного порожнього рядка', () => {
    expect(collapseMultipleBlankLines('a\n\n\nb')).toBe('a\n\nb')
    expect(collapseMultipleBlankLines('a\n\n\n\nb')).toBe('a\n\nb')
  })

  test('не змінює один порожній рядок між абзацами', () => {
    expect(collapseMultipleBlankLines('a\n\nb')).toBe('a\n\nb')
  })
})

describe('expandMustacheSection', () => {
  test('не вставляє порожній рядок між елементами списку', () => {
    const template = `intro:\n\n{{#items}}\n{{name}}\n{{/items}}\n\n## Next`
    const items = [{ name: '- a' }, { name: '- b' }]
    const out = expandMustacheSection(template, 'items', items, 'name')
    expect(out).toBe('intro:\n\n- a\n- b\n\n## Next')
    expect(out).not.toMatch(TRIPLE_OR_MORE_NEWLINES)
  })
})

describe('renderAgentsTemplate', () => {
  test('списки rules/skills/commands без подвійних порожніх рядків', () => {
    const template = `{{#services}}
{{name}}
{{/services}}

## Skills

{{#skills}}
{{name}}
{{/skills}}

## Commands

{{#commands}}
{{name}}
{{/commands}}
`
    const body = renderAgentsTemplate(
      template,
      ['n-a.mdc', 'n-b.mdc'],
      [{ name: '- skill-a' }, { name: '- skill-b' }],
      [{ name: '- cmd-a' }]
    )
    expect(body).toContain('- .cursor/rules/n-a.mdc\n- .cursor/rules/n-b.mdc')
    expect(body).toContain('- skill-a\n- skill-b')
    expect(body).not.toMatch(TRIPLE_OR_MORE_NEWLINES)
  })
})

describe('formatGeneratedMarkdownLines', () => {
  test('прибирає подвійний порожній рядок між секціями CLAUDE.md', () => {
    const out = formatGeneratedMarkdownLines(['@a.mdc', '', '', '## Skills', ''])
    expect(out).toBe('@a.mdc\n\n## Skills\n')
  })
})
