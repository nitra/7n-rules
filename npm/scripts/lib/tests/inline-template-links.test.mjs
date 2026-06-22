import { describe, expect, test } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inlineMarkdownIncludes, inlineTemplateLinks } from '../inline-template-links.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '__fixtures__', 'inline-template')
const SECURITY_RULE_DIR = join(HERE, '..', '..', '..', 'rules', 'security')

describe('inlineTemplateLinks', () => {
  test('json link → fenced json block', async () => {
    const text = '[snippet.json](./js/foo/template/snippet.json)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe('`snippet.json`:\n\n```json\n{ "key": "val" }\n```')
  })

  test('toml link → fenced toml block (label normalized to .gitleaks.toml)', async () => {
    const text = '[.gitleaks.toml.snippet.toml](./js/foo/template/.gitleaks.toml.snippet.toml)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe('`.gitleaks.toml`:\n\n```toml\ntitle = "x"\n```')
  })

  test('yml link → fenced yaml block', async () => {
    const text = '[config.yml](./policy/bar/template/config.yml)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe('`config.yml`:\n\n```yaml\nkey: val\n```')
  })

  test('unknown extension → no lang', async () => {
    const text = '[file.txt](./policy/bar/template/file.txt)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe('`file.txt`:\n\n```\nhello\n```')
  })

  test('non-template link left intact', async () => {
    const text = '[README](./README.md)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe('[README](./README.md)')
  })

  test('external link left intact', async () => {
    const text = '[gitleaks](https://github.com/gitleaks/gitleaks)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe('[gitleaks](https://github.com/gitleaks/gitleaks)')
  })

  test('normalizes label: strips .snippet.<ext> → target basename', async () => {
    const text = '[package.json.snippet.json](./policy/package_json/template/package.json.snippet.json)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result.startsWith('`package.json`:')).toBe(true)
  })

  test('normalizes label: strips .deny.<ext> → target basename', async () => {
    const text = '[package.json.deny.json](./policy/package_json/template/package.json.deny.json)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result.startsWith('`package.json`:')).toBe(true)
  })

  test('normalizes label: strips .contains.<ext> → target basename', async () => {
    const text = '[package.json.contains.json](./policy/package_json/template/package.json.contains.json)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result.startsWith('`package.json`:')).toBe(true)
  })

  test('normalizes label: strips .snippet.<ext> with dotfile target → .gitleaks.toml', async () => {
    const text = '[.gitleaks.toml.snippet.toml](./js/foo/template/.gitleaks.toml.snippet.toml)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result.startsWith('`.gitleaks.toml`:')).toBe(true)
  })

  test('preserves $ characters in template content (no $-pattern substitution)', async () => {
    const text = 'Canon: [with-dollar.toml](./js/foo/template/with-dollar.toml)\nTail after.'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe("Canon: `with-dollar.toml`:\n\n```toml\npaths = ['''.*\\.lock$''']\n```\nTail after.")
  })

  test('missing file throws', async () => {
    const text = '[missing.json](./js/foo/template/missing.json)'
    await expect(inlineTemplateLinks(text, FIXTURES)).rejects.toThrow(
      `inlineTemplateLinks: file not found: ${join(FIXTURES, 'js/foo/template/missing.json')} (referenced from .mdc)`
    )
  })

  test('multiple links in same text both get inlined', async () => {
    const text = [
      '[snippet.json](./js/foo/template/snippet.json)',
      '[config.yml](./policy/bar/template/config.yml)'
    ].join(' and ')
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe('`snippet.json`:\n\n```json\n{ "key": "val" }\n``` and `config.yml`:\n\n```yaml\nkey: val\n```')
  })

  test('integration: security.mdc — template links inlined, non-template links untouched', async () => {
    const { readFile } = await import('node:fs/promises')
    const mdc = await readFile(join(SECURITY_RULE_DIR, 'security.mdc'), 'utf8')
    const result = await inlineTemplateLinks(mdc, SECURITY_RULE_DIR)

    // Template links are gone (inlined)
    expect(result).not.toContain('[package.json.deny.json](./policy/package_json/template/package.json.deny.json)')
    expect(result).not.toContain(
      '[lint-security.yml.snippet.yml](./policy/lint_security_yml/template/lint-security.yml.snippet.yml)'
    )

    // Inline content from the actual template files is present
    expect(result).toContain('(^|/)node_modules(/|$)')
    expect(result).toContain('uses: trufflesecurity/trufflehog@main')

    // Non-template links are untouched
    expect(result).toContain('[TruffleHog](https://github.com/trufflesecurity/trufflehog)')
  })
})

describe('inlineMarkdownIncludes', () => {
  test('.mdc link → inlined raw markdown content', async () => {
    const text = '[section](./js/section.mdc)'
    const result = await inlineMarkdownIncludes(text, FIXTURES)
    expect(result).toBe('## Section title\n\nContent from the included section file.')
  })

  test('non-.mdc link left intact', async () => {
    const text = '[README](./README.md)'
    const result = await inlineMarkdownIncludes(text, FIXTURES)
    expect(result).toBe('[README](./README.md)')
  })

  test('external link left intact', async () => {
    const text = '[docs](https://example.com/docs.mdc)'
    const result = await inlineMarkdownIncludes(text, FIXTURES)
    expect(result).toBe('[docs](https://example.com/docs.mdc)')
  })

  test('.mdc link inside /template/ path left intact (handled by inlineTemplateLinks)', async () => {
    const text = '[tmpl](./policy/bar/template/foo.mdc)'
    const result = await inlineMarkdownIncludes(text, FIXTURES)
    expect(result).toBe('[tmpl](./policy/bar/template/foo.mdc)')
  })

  test('multiple .mdc includes both get inlined', async () => {
    const text = '[a](./js/section.mdc) and [b](./js/section.mdc)'
    const result = await inlineMarkdownIncludes(text, FIXTURES)
    const body = '## Section title\n\nContent from the included section file.'
    expect(result).toBe(`${body} and ${body}`)
  })

  test('missing file throws', async () => {
    const text = '[missing](./js/missing.mdc)'
    await expect(inlineMarkdownIncludes(text, FIXTURES)).rejects.toThrow(
      `inlineMarkdownIncludes: file not found: ${join(FIXTURES, 'js/missing.mdc')} (referenced from .mdc)`
    )
  })

  test('integration: abie.mdc — includes inlined, template links and plain text untouched', async () => {
    const { readFile } = await import('node:fs/promises')
    const abieDir = join(HERE, '..', '..', '..', 'rules', 'abie')
    const mdc = await readFile(join(abieDir, 'abie.mdc'), 'utf8')
    const withTemplates = await inlineTemplateLinks(mdc, abieDir)
    const result = await inlineMarkdownIncludes(withTemplates, abieDir)

    // Include links are gone
    expect(result).not.toContain('[k8s-hc-yaml](./js/hc_pairing.mdc)')

    // Content from included files is present
    expect(result).toContain('## k8s: `hc.yaml` поруч із Deployment')
    expect(result).toContain('## Внутрішньокластерні URL у env-файлах')

    // Template link in abie.mdc (Git branches section) still gets inlined by inlineTemplateLinks
    expect(result).not.toContain('clean-merged-branch.yml.snippet.yml')
  })
})
