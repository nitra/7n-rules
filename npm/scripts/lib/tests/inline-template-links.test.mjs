import { describe, expect, test } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { appendDiscoveredMdcFiles, inlineTemplateLinks } from '../inline-template-links.mjs'

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

  test('integration: security — concern MDC content appended as-is', async () => {
    const { readFile } = await import('node:fs/promises')
    const securityDir = SECURITY_RULE_DIR
    const mdc = await readFile(join(securityDir, 'main.mdc'), 'utf8')
    const withTemplates = await inlineTemplateLinks(mdc, securityDir)
    const result = await appendDiscoveredMdcFiles(withTemplates, securityDir)

    // Concern MDC headings are present
    expect(result).toContain('## Заборона `trufflehog` у залежностях `package.json`')
    // Workflow-концерн lint_security_yml переїхав у плагін @7n/rules-ci-github —
    // його вміст (trufflesecurity/trufflehog@main) доінлайнюється лише через extras.
    expect(result).not.toContain('trufflesecurity/trufflehog@main')

    // Non-template links are untouched
    expect(result).toContain('[TruffleHog](https://github.com/trufflesecurity/trufflehog)')

    // Template links inside concern MDCs are raw (not processed by appendDiscoveredMdcFiles)
    expect(result).toContain('[package.json.deny.json](./template/package.json.deny.json)')
  })
})

describe('appendDiscoveredMdcFiles', () => {
  test('no js/ or policy/ → text unchanged', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const tmp = await mkdtemp(join(tmpdir(), 'itl-test-'))
    try {
      const result = await appendDiscoveredMdcFiles('# main\n', tmp)
      expect(result).toBe('# main\n')
    } finally {
      await rm(tmp, { recursive: true })
    }
  })

  test('js/*.mdc discovered and appended alphabetically', async () => {
    const result = await appendDiscoveredMdcFiles('# main\n', FIXTURES)
    expect(result).toContain('## Section title')
    expect(result).toContain('Content from the included section file.')
    expect(result.indexOf('# main')).toBeLessThan(result.indexOf('## Section title'))
  })

  test('concern/*.mdc discovered and appended (алфавітно за concern-dir)', async () => {
    const result = await appendDiscoveredMdcFiles('# main\n', FIXTURES)
    expect(result).toContain('## Bar policy section')
    expect(result).toContain('Content from the bar policy concern file.')
    // bar/ < section/ алфавітно
    const barIdx = result.indexOf('## Bar policy section')
    const sectionIdx = result.indexOf('## Section title')
    expect(barIdx).toBeLessThan(sectionIdx)
  })

  test('template/ subdir .mdc files are NOT discovered (only direct concern files)', async () => {
    const result = await appendDiscoveredMdcFiles('# main\n', FIXTURES)
    expect(result).not.toContain('template/foo.mdc')
  })

  test('integration: abie rule — js/ and policy/ mdc files appended', async () => {
    const { readFile } = await import('node:fs/promises')
    const abieDir = join(HERE, '..', '..', '..', 'rules', 'abie')
    const mdc = await readFile(join(abieDir, 'main.mdc'), 'utf8')
    const withTemplates = await inlineTemplateLinks(mdc, abieDir)
    const result = await appendDiscoveredMdcFiles(withTemplates, abieDir)

    // JS concern MDC content is present
    expect(result).toContain('## k8s: `hc.yaml` поруч із Deployment')
    expect(result).toContain('## Внутрішньокластерні URL у env-файлах')

    // No leftover explicit include-link syntax (old [label](./js/concern.mdc) style)
    expect(result).not.toContain('[k8s-hc-yaml](./js/hc_pairing.mdc)')

    // Template links in main.mdc are inlined (clean-merged-branch.yml.snippet.yml → no longer a link)
    // but template links inside concern MDCs are appended as-is (raw)
    expect(result).not.toContain('[clean-merged-branch.yml.snippet.yml](./policy/clean_merged_ignore_branches/template')
  })
})
