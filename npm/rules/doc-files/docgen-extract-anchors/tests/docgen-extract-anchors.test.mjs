import { describe, expect, test } from 'vitest'

import { extractAnchors, anchorTokens } from '../main.mjs'

describe("configRefs — повне ім'я файлу, без зрізу всередині складеного імені (R1)", () => {
  test('settings.local.json не ріжеться на хибний .local.json', () => {
    const a = extractAnchors("const REL = '.claude/settings.local.json'\n")
    expect(a.configRefs).toContain('settings.local.json')
    expect(a.configRefs).not.toContain('.local.json')
  })

  test('capacitor.config.json не ріжеться на хибний .config.json', () => {
    const a = extractAnchors("existsSync(join(root, 'capacitor.config.json'))\n")
    expect(a.configRefs).toContain('capacitor.config.json')
    expect(a.configRefs).not.toContain('.config.json')
  })

  test('дотфайл-конфіг лишається цілим', () => {
    const a = extractAnchors("import cfg from '.n-rules.json'\n")
    expect(a.configRefs).toContain('.n-rules.json')
  })

  test('звичайний package.json захоплюється цілим', () => {
    const a = extractAnchors("await readFile('package.json', 'utf8')\n")
    expect(a.configRefs).toContain('package.json')
  })

  test('кожен анкор-конфіг — дослівний підрядок джерела (інваріант валідності)', () => {
    const src = "const A = '.claude/settings.local.json'\nconst B = 'capacitor.config.json'\n"
    for (const ref of extractAnchors(src).configRefs) expect(src).toContain(ref)
  })
})

describe('urls — template-literal обрізається до статичного префікса (R10)', () => {
  test('інтерпольований вираз у URL не тягне сміття в анкор', () => {
    // template-literal у фікстурі: \${…} екрановано, тож представляє вихідний код без інтерполяції
    const src = `fetch(\`https://pypi.org/pypi/\${encodeURIComponent(name)}/json\`)`
    expect(extractAnchors(src).urls).toEqual(['https://pypi.org/pypi/'])
  })

  test('звичайний URL лишається цілим', () => {
    expect(extractAnchors('// https://example.com/doc/page').urls).toEqual(['https://example.com/doc/page'])
  })
})

describe('anchorTokens — плоский список для перевірки покриття (R5)', () => {
  test('збирає urls, імена констант, маркери (rule.mdc), конфіги', () => {
    const src = [
      '// https://example.com/doc',
      "export const TAG = 'x-tag'",
      "throw new Error('погано (foo.mdc)')",
      "readFile('.n-rules.json')"
    ].join('\n')
    const tokens = anchorTokens(extractAnchors(src))
    expect(tokens).toContain('https://example.com/doc')
    expect(tokens).toContain('TAG')
    expect(tokens).toContain('(foo.mdc)')
    expect(tokens).toContain('.n-rules.json')
  })
})
