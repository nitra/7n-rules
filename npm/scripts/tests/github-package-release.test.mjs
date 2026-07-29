import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

import { ensureDir, withTmpDir, writeJson } from '../utils/test-helpers.mjs'
import { extractChangelogSection, findPublishablePackage, parsePackageTag, prepareGitHubRelease } from '../github-package-release.mjs'

describe('parsePackageTag', () => {
  test('розділяє scoped package і semver за останнім @', () => {
    expect(parsePackageTag('@7n/rules@1.54.0')).toEqual({ name: '@7n/rules', version: '1.54.0' })
  })

  test('розділяє unscoped package і semver', () => {
    expect(parsePackageTag('tool@2.0.0')).toEqual({ name: 'tool', version: '2.0.0' })
  })
})

describe('extractChangelogSection', () => {
  test('повертає тільки секцію запитаної версії', () => {
    const changelog = '# Changelog\n\n## [1.2.0] - 2026-07-29\n\n### Added\n\n- Нове\n\n## [1.1.0] - 2026-07-01\n\n### Fixed\n\n- Старе\n'

    expect(extractChangelogSection(changelog, '1.2.0')).toBe('## [1.2.0] - 2026-07-29\n\n### Added\n\n- Нове')
  })
})

describe('findPublishablePackage', () => {
  test('знаходить scoped package без hardcoded workspace-шляху', async () => {
    await withTmpDir(async root => {
      const packageDir = join(root, 'packages', 'rules')
      await ensureDir(packageDir)
      await writeJson(join(packageDir, 'package.json'), { name: '@7n/rules', version: '1.54.0' })
      await writeFile(join(packageDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8')

      expect(findPublishablePackage(root, '@7n/rules')).toEqual({ dir: packageDir, version: '1.54.0' })
    })
  })
})

describe('prepareGitHubRelease', () => {
  test('формує title і notes з changelog package-версії', async () => {
    await withTmpDir(async root => {
      const packageDir = join(root, 'packages', 'rules')
      await ensureDir(packageDir)
      await writeJson(join(packageDir, 'package.json'), { name: '@7n/rules', version: '1.54.0' })
      await writeFile(join(packageDir, 'CHANGELOG.md'), '# Changelog\n\n## [1.54.0] - 2026-07-29\n\n### Added\n\n- GitHub Releases\n', 'utf8')

      expect(prepareGitHubRelease(root, '@7n/rules@1.54.0')).toEqual({
        title: '@7n/rules@1.54.0',
        notes: '## [1.54.0] - 2026-07-29\n\n### Added\n\n- GitHub Releases'
      })
    })
  })
})

test('package-release workflow обробляє package-теги і створює відсутній Release', () => {
  const workflow = readFileSync('.github/workflows/package-release.yml', 'utf8')

  expect(workflow).toContain("tags:\n      - '@*@*'")
  expect(workflow).toContain('contents: write')
  expect(workflow).toContain('gh release view')
  expect(workflow).toContain('gh release create')
})
