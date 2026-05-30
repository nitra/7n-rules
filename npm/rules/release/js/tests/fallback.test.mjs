import { describe, expect, test } from 'vitest'

import { defaultRunGit, synthesizeChangeFromCommits } from '../../lib/fallback.mjs'

/**
 * Стаб git: мапить ключ-команду на stdout (або кидає → null-гілка).
 * @param {Record<string, string>} map мапа `args.join(' ')` → stdout
 * @returns {(args: string[]) => Promise<string | null>} стаб
 */
function gitStub(map) {
  return args => Promise.resolve(Object.hasOwn(map, args.join(' ')) ? map[args.join(' ')] : null)
}

describe('synthesizeChangeFromCommits', () => {
  test('бере commit-subjects від останнього тегу пакета', async () => {
    const runGit = gitStub({
      'describe --tags --abbrev=0 --match p@* HEAD': 'p@1.2.0\n',
      'log --no-merges --format=%s p@1.2.0..HEAD -- pkg/': 'feat: A\nfix: B\n'
    })
    const r = await synthesizeChangeFromCommits('p', 'pkg', { runGit })
    expect(r).toEqual({ bump: 'patch', section: 'Changed', description: 'feat: A; fix: B' })
  })

  test('без тегу пакета (bootstrap) → null, щоб не подвоїти bump', async () => {
    const runGit = gitStub({
      'describe --tags --abbrev=0 --match p@* HEAD': null
    })
    expect(await synthesizeChangeFromCommits('p', 'pkg', { runGit })).toBeNull()
  })

  test('нуль комітів → null', async () => {
    const runGit = gitStub({
      'describe --tags --abbrev=0 --match p@* HEAD': 'p@1.0.0\n',
      'log --no-merges --format=%s p@1.0.0..HEAD -- pkg/': '\n'
    })
    expect(await synthesizeChangeFromCommits('p', 'pkg', { runGit })).toBeNull()
  })
})

describe('defaultRunGit', () => {
  test('повертає stdout для успішної git-команди', async () => {
    const runGit = defaultRunGit(process.cwd())
    const result = await runGit(['--version'])
    expect(typeof result).toBe('string')
    expect(result).toContain('git version')
  })

  test('повертає null при помилці (неіснуючий cwd)', async () => {
    const runGit = defaultRunGit('/nonexistent-path-abc123')
    const result = await runGit(['log', '--oneline', '-1'])
    expect(result).toBeNull()
  })
})
