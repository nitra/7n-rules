import { describe, expect, test } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { writeChange } from '../../change.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

describe('writeChange', () => {
  test('пише <ws>/.changes/<name>.md з валідним вмістом і повертає шлях', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'p', version: '1.0.0', files: ['x'] })
      const rel = await writeChange({ bump: 'minor', section: 'Added', message: 'Нова фіча', ws: '.', cwd: dir })
      expect(rel.startsWith('.changes/')).toBe(true)
      const names = await readdir(join(dir, '.changes'))
      expect(names).toHaveLength(1)
      const text = await readFile(join(dir, '.changes', names[0]), 'utf8')
      expect(text).toBe('---\nbump: minor\nsection: Added\n---\nНова фіча\n')
    })
  })

  test('кидає на невалідному bump/section/порожньому message', async () => {
    await withTmpDir(async dir => {
      await expect(writeChange({ bump: 'huge', section: 'Added', message: 'x', ws: '.', cwd: dir })).rejects.toThrow()
      await expect(writeChange({ bump: 'patch', section: 'Added', message: '', ws: '.', cwd: dir })).rejects.toThrow()
    })
  })
})
