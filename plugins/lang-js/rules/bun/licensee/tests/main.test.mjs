/**
 * Тести detector-а `bun/licensee` (main.mjs): `spawnAsync` мокається — реальний
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

const spawnAsyncMock = vi.fn()
vi.mock('@7n/rules/scripts/utils/spawn-async.mjs', () => ({ spawnAsync: spawnAsyncMock }))
vi.mock('@7n/rules/scripts/utils/resolve-cmd.mjs', () => ({ resolveCmd: () => '/usr/local/bin/bun' }))

const { lint } = await import('../main.mjs')
const { withTmpDir } = await import('@7n/rules/scripts/utils/test-helpers.mjs')

describe('bun/licensee detector', () => {
  test('немає .licensee.json → licensee-config-missing, spawnAsync не викликається', async () => {
    spawnAsyncMock.mockReset()
    await withTmpDir(async dir => {
      const { violations } = await lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('licensee-config-missing')
      expect(spawnAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('status 0 → без порушень', async () => {
    spawnAsyncMock.mockReset()
    spawnAsyncMock.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await withTmpDir(async dir => {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(0)
    })
  })

  test('status 1 + непорожній stderr (die()) → fail-open діагностика, НЕ violation', async () => {
    spawnAsyncMock.mockReset()
    spawnAsyncMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: "Cannot read properties of undefined (reading 'localeCompare')"
    })
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations, diagnostics } = await lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(0)
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0].level).toBe('warn')
      expect(diagnostics[0].message).toContain('НЕ підтверджене ліцензійне порушення')
      expect(diagnostics[0].message).toContain('localeCompare')
    })
  })

  test('status 1 + порожній stderr, непорожній stdout (--errors-only print()) → license-violation з деталлю', async () => {
    spawnAsyncMock.mockReset()
    spawnAsyncMock.mockResolvedValue({
      exitCode: 1,
      stdout: 'left-pad@1.0.0\n  NOT APPROVED\n  Terms: GPL-3.0\n',
      stderr: ''
    })
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('license-violation')
      expect(violations[0].message).toContain('left-pad@1.0.0')
      expect(violations[0].message).toContain('NOT APPROVED')
    })
  })

  test('бун не в PATH → bun-missing', async () => {
    spawnAsyncMock.mockReset()
    const resolveCmdModule = await import('@7n/rules/scripts/utils/resolve-cmd.mjs')
    vi.spyOn(resolveCmdModule, 'resolveCmd').mockReturnValueOnce('')
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('bun-missing')
      expect(spawnAsyncMock).not.toHaveBeenCalled()
    })
  })

  test('стороння NOT APPROVED ліцензія → license-violation, метадані власного пакета без license → license-metadata-invalid (окремо)', async () => {
    spawnAsyncMock.mockReset()
    spawnAsyncMock.mockResolvedValue({
      exitCode: 1,
      stdout:
        'lru-cache@11.5.1\n' +
        '  NOT APPROVED\n' +
        '  Terms: BlueOak-1.0.0\n' +
        '  Repository: git+ssh://git@github.com/isaacs/node-lru-cache.git\n\n' +
        'foo@0.0.0\n' +
        '  NOT APPROVED\n' +
        '  Terms: Invalid license metadata\n' +
        '  Repository: None listed\n',
      stderr: ''
    })
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })

      const metadataViolations = violations.filter(v => v.reason === 'license-metadata-invalid')
      expect(metadataViolations).toHaveLength(1)
      expect(metadataViolations[0].data).toEqual({ package: 'foo' })

      const violationOnly = violations.filter(v => v.reason === 'license-violation')
      expect(violationOnly).toHaveLength(1)
      expect(violationOnly[0].message).toContain('lru-cache@11.5.1')
      expect(violationOnly[0].message).not.toContain('foo@0.0.0')
    })
  })

  test('лише Invalid license metadata (без сторонніх порушень) → тільки license-metadata-invalid', async () => {
    spawnAsyncMock.mockReset()
    spawnAsyncMock.mockResolvedValue({
      exitCode: 1,
      stdout: 'root-pkg@0.0.0\n  NOT APPROVED\n  Terms: Invalid license metadata\n  Repository: None listed\n',
      stderr: ''
    })
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('license-metadata-invalid')
      expect(violations[0].data).toEqual({ package: 'root-pkg' })
    })
  })

  test('нерозпізнаний формат stdout → fallback на агрегований license-violation', async () => {
    spawnAsyncMock.mockReset()
    spawnAsyncMock.mockResolvedValue({ exitCode: 1, stdout: 'щось геть інше без блоків пакетів', stderr: '' })
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.licensee.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'bun', concernId: 'licensee' })
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe('license-violation')
    })
  })
})
