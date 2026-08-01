import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { env, execPath } from 'node:process'
import { fileURLToPath } from 'node:url'

import { collectChangedFiles, collectChangedFilesSince, resolveChangedBase } from '../changed-files.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

/**
 * Parity-гейт зрізу 1 фази 8 (`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`,
 * рішення Ж): вихід native-підкоманд бінаря `rules-cli` byte-exact із
 * JS-еквівалентом — `lint --help` проти самого JS-CLI, `changed-files`
 * (усі три режими) проти фасадів `changed-files.mjs` на живих git-фікстурах.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
/** Корінь репо: npm/scripts/lib/tests → up 4. */
const REPO_ROOT = join(HERE, '..', '..', '..', '..')
const JS_ENTRY = join(REPO_ROOT, 'npm', 'bin', 'n-rules.js')

/**
 * Резолвить шлях до зібраного бінаря `rules-cli` — той самий каскад, що
 * loader native-аддона (`npm/scripts/lib/native.mjs`): явний override →
 * dev-збірка `target/{release,debug}`; відсутність — hard error з підказкою
 * (не мовчазний skip, дірка в parity-гейті була б невидимою).
 * @returns {string} шлях до бінаря
 */
function resolveRulesCliBin() {
  const override = env.N_RULES_CLI_BIN
  if (override) return override
  const name = process.platform === 'win32' ? 'rules-cli.exe' : 'rules-cli'
  for (const profile of ['release', 'debug']) {
    const candidate = join(REPO_ROOT, 'target', profile, name)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'rules-cli parity: немає збірки бінаря. Постав N_RULES_CLI_BIN=/шлях/до/rules-cli ' +
      'або збери локально: cargo build --release -p rules-cli'
  )
}

/**
 * Запускає зібраний `rules-cli` і повертає результат.
 * @param {string[]} args аргументи CLI
 * @param {string} [cwd] робочий каталог
 * @returns {{ stdout: string, stderr: string, status: number|null }} результат
 */
function runRulesCli(args, cwd = REPO_ROOT) {
  return spawnSync(resolveRulesCliBin(), args, { cwd, encoding: 'utf8' })
}

/**
 * Ініціалізує git-репо у dir з одним закоміченим `base.js` (та сама фікстура,
 * що в `changed-files.test.mjs`).
 * @param {string} dir каталог
 * @returns {string} той самий dir
 */
function initRepo(dir) {
  spawnSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'base.js'), 'export const a = 1\n', 'utf8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

/**
 * Очікуваний plumbing-вивід зі списку фасада (по шляху на рядок).
 * @param {string[]} files список шляхів
 * @returns {string} байтовий еквівалент stdout
 */
function asLines(files) {
  return files.map(f => `${f}\n`).join('')
}

describe('rules-cli parity: lint --help', () => {
  test('вивід byte-exact із JS-CLI (обидва прапори)', () => {
    for (const flag of ['--help', '-h']) {
      const js = spawnSync(execPath, [JS_ENTRY, 'lint', flag], { cwd: REPO_ROOT, encoding: 'utf8' })
      const native = runRulesCli(['lint', flag])
      expect(js.status).toBe(0)
      expect(native.status).toBe(0)
      expect(native.stdout).toBe(js.stdout)
    }
  })
})

describe('rules-cli parity: changed-files', () => {
  test('без прапорців — робоче дерево vs HEAD (collectChangedFiles)', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      writeFileSync(join(dir, 'base.js'), 'export const a = 2\n', 'utf8')
      writeFileSync(join(dir, 'new.ts'), 'export const b = 3\n', 'utf8')
      const native = runRulesCli(['changed-files'], dir)
      expect(native.status).toBe(0)
      expect(native.stdout).toBe(asLines(collectChangedFiles(dir)))
    })
  })

  test('--base <ref> — явна база (resolveChangedBase + collectChangedFilesSince)', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      writeFileSync(join(dir, 'second.js'), 'export const c = 1\n', 'utf8')
      spawnSync('git', ['add', '.'], { cwd: dir })
      spawnSync('git', ['commit', '-qm', 'second'], { cwd: dir })
      writeFileSync(join(dir, 'wip.ts'), 'export const d = 1\n', 'utf8')
      const base = resolveChangedBase(dir, 'HEAD~1')
      expect(base).not.toBeNull()
      const native = runRulesCli(['changed-files', '--base', 'HEAD~1'], dir)
      expect(native.status).toBe(0)
      expect(native.stdout).toBe(asLines(collectChangedFilesSince(base, dir)))
    })
  })

  test('--delta — merge-base за Git policy (гілка від main + робоче дерево)', async () => {
    await withTmpDir(dir => {
      initRepo(dir)
      spawnSync('git', ['checkout', '-qb', 'feature'], { cwd: dir })
      writeFileSync(join(dir, 'committed.js'), 'export const e = 1\n', 'utf8')
      spawnSync('git', ['add', '.'], { cwd: dir })
      spawnSync('git', ['commit', '-qm', 'feature'], { cwd: dir })
      writeFileSync(join(dir, 'untracked.ts'), 'export const f = 1\n', 'utf8')
      const base = resolveChangedBase(dir)
      const expected = base === null ? collectChangedFiles(dir) : collectChangedFilesSince(base, dir)
      const native = runRulesCli(['changed-files', '--delta'], dir)
      expect(native.status).toBe(0)
      expect(native.stdout).toBe(asLines(expected))
    })
  })
})
