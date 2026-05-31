import { describe, expect, test } from 'vitest'

import {
  bumpVersion,
  maxBump,
  renderChangelogSection,
  prependChangelogSection,
  aggregateWorkspace
} from '../../lib/aggregate.mjs'

const RE_SEMVER = /semver/u

describe('bumpVersion', () => {
  test('major/minor/patch обнуляють молодші розряди', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })
  test('кидає на невалідній версії', () => {
    expect(() => bumpVersion('1.2', 'patch')).toThrow(RE_SEMVER)
  })
})

describe('maxBump', () => {
  test('обирає найвищий', () => {
    expect(maxBump(['patch', 'minor', 'patch'])).toBe('minor')
    expect(maxBump(['patch', 'major', 'minor'])).toBe('major')
    expect(maxBump(['patch'])).toBe('patch')
  })
})

describe('renderChangelogSection', () => {
  test('групує bullets по секціях у канонічному порядку', () => {
    const block = renderChangelogSection('1.3.0', '2026-05-29', [
      { section: 'Fixed', description: 'Виправив B' },
      { section: 'Added', description: 'Додав A' },
      { section: 'Added', description: 'Додав A2' }
    ])
    expect(block).toBe('## [1.3.0] - 2026-05-29\n\n### Added\n\n- Додав A\n- Додав A2\n\n### Fixed\n\n- Виправив B\n')
  })
})

describe('prependChangelogSection', () => {
  test('вставляє секцію зверху, зберігаючи заголовок Keep a Changelog', () => {
    const existing = '# Changelog\n\nПреамбула.\n\n## [1.2.0] - 2026-01-01\n\n### Added\n\n- old\n'
    const out = prependChangelogSection(existing, '## [1.3.0] - 2026-05-29\n\n### Added\n\n- new\n')
    expect(out).toContain('# Changelog')
    expect(out.indexOf('## [1.3.0]')).toBeLessThan(out.indexOf('## [1.2.0]'))
    expect(out).toContain('Преамбула.')
  })
  test('файл без заголовка # — секція просто зверху', () => {
    expect(prependChangelogSection('', '## [1.0.0] - 2026-05-29\n\n### Added\n\n- x\n')).toBe(
      '# Changelog\n\n## [1.0.0] - 2026-05-29\n\n### Added\n\n- x\n'
    )
  })
})

describe('aggregateWorkspace', () => {
  test('обчислює нову версію (max bump) і блок секції, перелічує consumed-файли', () => {
    const changeFiles = [
      { file: '1-a.md', entry: { bump: 'patch', section: 'Fixed', description: 'fix' } },
      { file: '2-b.md', entry: { bump: 'minor', section: 'Added', description: 'feat' } }
    ]
    const r = aggregateWorkspace({ currentVersion: '1.2.3', changeFiles, date: '2026-05-29' })
    expect(r.newVersion).toBe('1.3.0')
    expect(r.sectionBlock).toContain('## [1.3.0] - 2026-05-29')
    expect(r.consumedFiles).toEqual(['1-a.md', '2-b.md'])
  })

  test('порожній список change-файлів → null', () => {
    expect(aggregateWorkspace({ currentVersion: '1.0.0', changeFiles: [], date: '2026-05-29' })).toBeNull()
  })
})
