import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { inlineTemplateLinks } from './inline-template-links.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '__fixtures__', 'inline-template')
const SECURITY_RULE_DIR = join(HERE, '..', '..', 'rules', 'security')

describe('inlineTemplateLinks', () => {
  test('json link → fenced json block', async () => {
    const text = '[snippet.json](./fix/foo/template/snippet.json)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe('`snippet.json`:\n\n```json\n{"key": "val"}\n```')
  })

  test('toml link → fenced toml block', async () => {
    const text = '[.gitleaks.toml.snippet.toml](./fix/foo/template/.gitleaks.toml.snippet.toml)'
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe('`.gitleaks.toml.snippet.toml`:\n\n```toml\ntitle = "x"\n```')
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

  test('missing file throws', async () => {
    const text = '[missing.json](./fix/foo/template/missing.json)'
    await expect(inlineTemplateLinks(text, FIXTURES)).rejects.toThrow(
      `inlineTemplateLinks: file not found: ${join(FIXTURES, 'fix/foo/template/missing.json')} (referenced from .mdc)`
    )
  })

  test('multiple links in same text both get inlined', async () => {
    const text = [
      '[snippet.json](./fix/foo/template/snippet.json)',
      '[config.yml](./policy/bar/template/config.yml)',
    ].join(' and ')
    const result = await inlineTemplateLinks(text, FIXTURES)
    expect(result).toBe(
      '`snippet.json`:\n\n```json\n{"key": "val"}\n``` and `config.yml`:\n\n```yaml\nkey: val\n```'
    )
  })

  test('integration: security.mdc — 4 template links inlined, non-template links untouched', async () => {
    const { readFile } = await import('node:fs/promises')
    const mdc = await readFile(join(SECURITY_RULE_DIR, 'security.mdc'), 'utf8')
    const result = await inlineTemplateLinks(mdc, SECURITY_RULE_DIR)

    // All 4 template links are gone
    expect(result).not.toContain('[package.json.snippet.json](./policy/package_json/template/package.json.snippet.json)')
    expect(result).not.toContain('[package.json.contains.json](./policy/package_json/template/package.json.contains.json)')
    expect(result).not.toContain('[package.json.deny.json](./policy/package_json/template/package.json.deny.json)')
    expect(result).not.toContain('[.gitleaks.toml.snippet.toml](./fix/gitleaks/template/.gitleaks.toml.snippet.toml)')

    // Inline content from the actual template files is present
    expect(result).toContain('```json\n{ "scripts": { "lint-security": "gitleaks detect --no-banner" } }\n```')
    expect(result).toContain('```toml\n')
    expect(result).toContain('useDefault = true')

    // Non-template links are untouched
    expect(result).toContain('[gitleaks](https://github.com/gitleaks/gitleaks)')
    // The yaml code block for the workflow is still present (not a template link)
    expect(result).toContain('```yaml title=".github/workflows/lint-security.yml"')
  })
})
