import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inlineTemplateLinks } from '../inline-template-links.mjs'

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

  test('integration: security.mdc — 5 template links inlined, non-template links untouched', async () => {
    const { readFile } = await import('node:fs/promises')
    const mdc = await readFile(join(SECURITY_RULE_DIR, 'security.mdc'), 'utf8')
    const result = await inlineTemplateLinks(mdc, SECURITY_RULE_DIR)

    // All 5 template links are gone
    expect(result).not.toContain(
      '[package.json.snippet.json](./policy/package_json/template/package.json.snippet.json)'
    )
    expect(result).not.toContain(
      '[package.json.contains.json](./policy/package_json/template/package.json.contains.json)'
    )
    expect(result).not.toContain('[package.json.deny.json](./policy/package_json/template/package.json.deny.json)')
    expect(result).not.toContain(
      '[.trufflehog-exclude.snippet.txt](./js/trufflehog/template/.trufflehog-exclude.snippet.txt)'
    )
    expect(result).not.toContain(
      '[lint-security.yml.snippet.yml](./policy/lint_security_yml/template/lint-security.yml.snippet.yml)'
    )

    // Inline content from the actual template files is present
    expect(result).toContain(
      '```json\n{\n  "scripts": {\n    "lint-security": "trufflehog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail"\n  }\n}\n```'
    )
    expect(result).toContain('(^|/)node_modules(/|$)')
    expect(result).toContain('uses: trufflesecurity/trufflehog@main')

    // Non-template links are untouched
    expect(result).toContain('[TruffleHog](https://github.com/trufflesecurity/trufflehog)')
  })
})
