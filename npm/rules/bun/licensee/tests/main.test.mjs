/**
 * Тести detector-а `bun/licensee` (main.mjs): `spawnSync` мокається — реальний
 * `bun x licensee` не запускається. Перевіряє розрізнення crash інструмента
 * (stderr через die()) від справжнього ліцензійного порушення (stdout через
 * print() з --errors-only) — інцидент: licensee@12 крашиться усередині
 * `@npmcli/arborist` на node_modules, зібраному bun install ("Cannot read
 * properties of undefined (reading 'localeCompare')"), і без цього розрізнення
 * повідомлялось як "порушення ліцензій", хоча жодного пакета не було перевірено.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

const spawnSyncMock = vi.fn()
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))
vi.mock('../../../../scripts/utils/resolve-cmd.mjs', () => ({ resolveCmd: () => '/usr/local/bin/bun' }))

const { lint } = await import('../main.mjs')
const { withTmpDir } = await import('../../../../scripts/utils/test-helpers.mjs')

describe('bun/licensee detector', () => {
  test('немає .licensee.json → licensee-config-missing, spawnSync не викликається', async () => {
    spawnSyncMock.mockReset()
    await withTmpDir(dir => {
      const { violations } = lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('licensee-config-missing')
      expect(spawnSyncMock).not.toHaveBeenCalled()
    })
  })

  test('status 0 → без порушень', async () => {
    spawnSyncMock.mockReset()
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    await withTmpDir(async dir => {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(0)
    })
  })

  test('status 1 + непорожній stderr (die()) → licensee-crashed, НЕ license-violation', async () => {
    spawnSyncMock.mockReset()
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: "Cannot read properties of undefined (reading 'localeCompare')"
    })
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('licensee-crashed')
      expect(violations[0].message).toContain('НЕ підтверджене ліцензійне порушення')
      expect(violations[0].message).toContain('localeCompare')
    })
  })

  test('status 1 + порожній stderr, непорожній stdout (--errors-only print()) → license-violation з деталлю', async () => {
    spawnSyncMock.mockReset()
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: 'left-pad@1.0.0\n  NOT APPROVED\n  Terms: GPL-3.0\n',
      stderr: ''
    })
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('license-violation')
      expect(violations[0].message).toContain('left-pad@1.0.0')
      expect(violations[0].message).toContain('NOT APPROVED')
    })
  })

  test('bun не в PATH → bun-missing', async () => {
    spawnSyncMock.mockReset()
    const resolveCmdModule = await import('../../../../scripts/utils/resolve-cmd.mjs')
    vi.spyOn(resolveCmdModule, 'resolveCmd').mockReturnValueOnce('')
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('bun-missing')
      expect(spawnSyncMock).not.toHaveBeenCalled()
    })
  })
})
