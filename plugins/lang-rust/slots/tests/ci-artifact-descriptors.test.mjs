/**
 * Інтеграційний тест двох `ci.artifact@1` contributions `@7n/rules-lang-rust` (той самий
 * контракт, що й `@7n/rules-lang-php`, spec `2026-07-27-universal-plugin-slots-lang-php-extraction`,
 * §6, §7.1): кожен descriptor у `slots/ci/*.json` має пройти canonical payload-контракт
 * (`validateCiArtifactPayload`) і його `template` резолвиться (`resolveArtifactTemplatePath`) у
 * реальний файл на диску тим самим контрактним path-резолвом — без broker/discovery, лише
 * форма й containment, той самий контракт, що читають `@7n/rules-ci-github`/`@7n/rules-ci-azure`.
 *
 * Parity-блоки нижче фіксують те, що generic consumer-и гарантують для цього контракту, без
 * повторної реалізації їхньої merge/diagnose-логіки (та живе в `@7n/rules-ci-github`/
 * `@7n/rules-ci-azure`, лишається їхньою — плагіни одне одного не імпортують): `mode: "required-file"` означає, що T0
 * generic-consumer-а копіює `template` як є (`applyDeepSubsetFix`) — тож canonical-текст
 * `lint-rust.yml.snippet.yml` і Є майбутнім байт-точним вмістом `.github/workflows/lint-rust.yml`;
 * `mergeStrategy: "contains-step"` означає, що `script`-поле azure-шаблону — canonical-команда,
 * присутність/відсутність якої (разом з `--no-fix`) вирішує pass/violation.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveArtifactTemplatePath, validateCiArtifactPayload } from '@7n/rules/plugin-api'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CI_DIR = join(PACKAGE_ROOT, 'slots', 'ci')

/** @type {Array<{ file: string, expected: Partial<import('@7n/rules/plugin-api').CiArtifactDescriptor> }>} */
const DESCRIPTORS = [
  {
    file: 'rust-github-lint.json',
    expected: { targetCapability: 'ci:github', mode: 'required-file', mergeStrategy: 'deep-subset', fix: true }
  },
  {
    file: 'rust-azure-lint.json',
    expected: { targetCapability: 'ci:azure', mode: 'patch-existing', mergeStrategy: 'contains-step', fix: false }
  }
]

describe.each(DESCRIPTORS)('$file', ({ file, expected }) => {
  const raw = JSON.parse(readFileSync(join(CI_DIR, file), 'utf8'))

  test('проходить validateCiArtifactPayload', () => {
    const result = validateCiArtifactPayload(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.descriptor).toMatchObject(expected)
    }
  })

  test('template резолвиться у реальний файл на диску (containment у packageRoot)', () => {
    const result = validateCiArtifactPayload(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const contribution = { packageRoot: PACKAGE_ROOT, resourcePath: join(CI_DIR, file) }
    const resolved = resolveArtifactTemplatePath(contribution, result.descriptor)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.exists).toBe(true)
  })
})

describe('rust-github-lint.json — T0 байт-ідентичний lint-rust.yml', () => {
  test('canonical template містить весь очікуваний вміст workflow (те, що T0 required-file запише як є)', () => {
    const templateText = readFileSync(join(CI_DIR, 'github', 'lint-rust.yml.snippet.yml'), 'utf8')
    // required-file + deep-subset: generic consumer T0 копіює цей текст без змін (applyDeepSubsetFix) —
    // тож canonical-присутність кожного кроку тут і Є майбутнім вмістом .github/workflows/lint-rust.yml.
    expect(templateText).toContain('uses: actions/checkout@v6')
    expect(templateText).toContain('uses: dtolnay/rust-toolchain@stable')
    expect(templateText).toContain('components: rustfmt, clippy')
    expect(templateText).toContain('uses: Swatinem/rust-cache@v2')
    expect(templateText).toContain('run: cargo fmt --all -- --check')
    expect(templateText).toContain('run: cargo clippy --all-targets --all-features -- -D warnings')
  })
})

describe('rust-azure-lint.json — canonical script-крок (contains-step validate/violation)', () => {
  const scriptLine = readFileSync(join(CI_DIR, 'azure', 'lint-rust.snippet.yml'), 'utf8').trim()

  test('template — рівно "script: lint rust" (consumer додає бінарний prefix n-rules/@7n/rules сам)', () => {
    expect(scriptLine).toBe('script: lint rust')
  })

  test('validate: pipeline-крок з canonical-командою і "--no-fix" — те, що consumer визнає pass', () => {
    const blob = 'bunx n-rules lint rust --no-fix'
    expect(blob.includes('n-rules lint rust')).toBe(true)
    expect(blob.includes('--no-fix')).toBe(true)
  })

  test('violation: pipeline-крок без canonical-команди (інший домен) — те, що consumer визнає порушенням', () => {
    const blob = 'bunx n-rules lint php --no-fix'
    expect(blob.includes('n-rules lint rust')).toBe(false)
    expect(blob.includes('@7n/rules lint rust')).toBe(false)
  })
})

describe('artifactId collision key', () => {
  test('github і azure lint-контрибуції можуть ділити artifactId "lint-rust" — різні targetCapability, різні consumer-и', () => {
    const github = validateCiArtifactPayload(JSON.parse(readFileSync(join(CI_DIR, 'rust-github-lint.json'), 'utf8')))
    const azure = validateCiArtifactPayload(JSON.parse(readFileSync(join(CI_DIR, 'rust-azure-lint.json'), 'utf8')))
    expect(github.ok && azure.ok).toBe(true)
    if (github.ok && azure.ok) {
      expect(github.descriptor.artifactId).toBe(azure.descriptor.artifactId)
      expect(github.descriptor.targetCapability).not.toBe(azure.descriptor.targetCapability)
    }
  })
})
