import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { env, execPath } from 'node:process'
import { fileURLToPath } from 'node:url'

import { collectChangedFiles, collectChangedFilesSince, resolveChangedBase } from '../changed-files.mjs'
import { runSkillsCli } from '../../skills-cli.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

/**
 * Parity-гейт фази 8 (`docs/specs/2026-08-01-rules-cli-phase8-skeleton.md`,
 * рішення Ж): вихід native-підкоманд бінаря `rules-cli` byte-exact із
 * JS-еквівалентом.
 *
 * Зріз 1: `lint --help` проти самого JS-CLI, `changed-files` (усі три режими)
 * проти фасадів `changed-files.mjs` на живих git-фікстурах.
 *
 * Зріз 2: `skill list` (проти JS-CLI на реальному пакеті + проти фасада
 * `runSkillsCli` на синтетичних фікстурах) і `rename-yaml-extensions` —
 * єдина МУТУЮЧА native-команда, тож там звіряється не лише stdout/stderr/
 * exit-код, а й СТАН ФАЙЛОВОЇ СИСТЕМИ після прогону (обидва боки ганяються
 * на двох ідентичних копіях дерева).
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
 * @param {Record<string, string>} [extraEnv] додаткові змінні середовища
 * @returns {{ stdout: string, stderr: string, status: number|null }} результат
 */
function runRulesCli(args, cwd = REPO_ROOT, extraEnv = {}) {
  return spawnSync(resolveRulesCliBin(), args, { cwd, encoding: 'utf8', env: { ...env, ...extraEnv } })
}

/**
 * Запускає JS-CLI (`npm/bin/n-rules.js`) у тому самому середовищі — еталон
 * паритету для команд, які JS-роутер уміє сам.
 * @param {string[]} args аргументи CLI
 * @param {string} cwd робочий каталог
 * @returns {{ stdout: string, stderr: string, status: number|null }} результат
 */
function runJsCli(args, cwd) {
  return spawnSync(execPath, [JS_ENTRY, ...args], { cwd, encoding: 'utf8', env: { ...env } })
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

/** Роздільник шляху обох платформ — для нормалізації зліпка в posix-форму. */
const PATH_SEPARATOR_RE = /[/\\]/u

/**
 * Створює каталоги під файл і записує його.
 * @param {string} root корінь фікстури
 * @param {string} rel відносний posix-шлях
 * @param {string} [text] вміст
 * @returns {void}
 */
function writeFixtureFile(root, rel, text = 'kind: Test\n') {
  const abs = join(root, ...rel.split('/'))
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, text, 'utf8')
}

/**
 * Рекурсивний зліпок дерева: відсортовані пари `шлях вміст`. Саме він
 * гейтить мутуючу команду — stdout може збігтись, а диск розійтись.
 * @param {string} root корінь
 * @param {string} [dir] поточний каталог обходу (рекурсія)
 * @returns {string[]} відсортований зліпок
 */
function snapshotTree(root, dir = root) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...snapshotTree(root, abs))
    } else {
      out.push(`${relative(root, abs).split(PATH_SEPARATOR_RE).join('/')} ${readFileSync(abs, 'utf8')}`)
    }
  }
  return out.toSorted()
}

describe('rules-cli parity: skill list', () => {
  test('реальний пакет — вивід byte-exact із JS-CLI', async () => {
    await withTmpDir(dir => {
      // cwd — порожній tmpdir: обидва боки читають `skills/` КОРЕНЯ ПАКЕТА,
      // не проєкту, і не зачіпають package.json відсутнього воркспейсу.
      const js = runJsCli(['skill', 'list'], dir)
      const native = runRulesCli(['skill', 'list'], dir, { N_RULES_JS_ENTRY: JS_ENTRY })
      expect(js.status).toBe(0)
      expect(native.status).toBe(0)
      expect(native.stdout).toBe(js.stdout)
      expect(native.stdout).toContain('Available skills:\n')
    })
  })

  test.each([
    ['звичайний набір', ['taze', 'lint', 'doc-files']],
    ['порядок localeCompare (`_` перед `-`)', ['doc_files', 'doc-files', 'Lint', 'lint']],
    ['порожній пакет', []]
  ])('синтетичний пакет (%s) — byte-exact із фасадом runSkillsCli', async (_name, ids) => {
    await withTmpDir(async dir => {
      const packageRoot = join(dir, 'pkg')
      for (const id of ids) writeFixtureFile(packageRoot, `skills/${id}/SKILL.md`, '# skill\n')
      if (ids.length === 0) mkdirSync(packageRoot, { recursive: true })

      const lines = []
      const errLines = []
      const jsCode = await runSkillsCli(['list'], {
        packageRoot,
        log: line => {
          lines.push(line)
        },
        logError: line => {
          errLines.push(line)
        }
      })
      const native = runRulesCli(['skill', 'list'], dir, {
        N_RULES_JS_ENTRY: join(packageRoot, 'bin', 'n-rules.js')
      })

      expect(native.status).toBe(jsCode)
      expect(native.stdout).toBe(lines.map(line => `${line}\n`).join(''))
      expect(native.stderr).toBe(errLines.map(line => `${line}\n`).join(''))
    })
  })

  test('каталог без SKILL.md і звичайний файл — не скіли (обидва боки)', async () => {
    await withTmpDir(async dir => {
      const packageRoot = join(dir, 'pkg')
      writeFixtureFile(packageRoot, 'skills/lint/SKILL.md', '# skill\n')
      mkdirSync(join(packageRoot, 'skills', 'no-skill-md'), { recursive: true })
      writeFixtureFile(packageRoot, 'skills/README.md', 'x\n')

      const lines = []
      const errLines = []
      await runSkillsCli(['list'], {
        packageRoot,
        log: line => {
          lines.push(line)
        },
        logError: line => {
          errLines.push(line)
        }
      })
      const native = runRulesCli(['skill', 'list'], dir, {
        N_RULES_JS_ENTRY: join(packageRoot, 'bin', 'n-rules.js')
      })
      expect(native.stdout).toBe('Available skills:\n- lint\n')
      expect(native.stdout).toBe(lines.map(line => `${line}\n`).join(''))
      expect(errLines).toEqual([])
      expect(native.stderr).toBe('')
    })
  })
})

/**
 * Звіряє результат обох боків повністю — вивід, exit-код і стан ФС.
 * @param {{ native: object, js: object, nativeTree: string[], jsTree: string[] }} result результат `runBothOnTwin`
 * @returns {void}
 */
function expectFullParity(result) {
  expect(result.native.stdout).toBe(result.js.stdout)
  expect(result.native.stderr).toBe(result.js.stderr)
  expect(result.native.status).toBe(result.js.status)
  expect(result.nativeTree).toEqual(result.jsTree)
}

describe('rules-cli parity: rename-yaml-extensions', () => {
  /**
   * Ганяє обидва CLI на ДВОХ ідентичних копіях дерева й звіряє stdout,
   * stderr, exit-код і стан файлової системи після прогону.
   * @param {string} dir tmpdir
   * @param {Array<[string, string]|[string]>} files пари `[відносний шлях, вміст?]`
   * @param {string[]} [args] аргументи після `rename-yaml-extensions`
   * @returns {{ native: object, js: object, nativeTree: string[], jsTree: string[] }} результати
   */
  function runBothOnTwin(dir, files, args = []) {
    const nativeRoot = join(dir, 'native')
    const jsRoot = join(dir, 'js')
    for (const root of [nativeRoot, jsRoot]) {
      for (const [rel, text] of files) writeFixtureFile(root, rel, text)
      mkdirSync(root, { recursive: true })
    }
    const native = runRulesCli(['rename-yaml-extensions', ...args], nativeRoot)
    const js = runJsCli(['rename-yaml-extensions', ...args], jsRoot)
    return { native, js, nativeTree: snapshotTree(nativeRoot), jsTree: snapshotTree(jsRoot) }
  }

  const MIXED_FIXTURE = [
    ['k8s/web.yml'],
    ['k8s/api_gateway.yml'],
    ['k8s/api-gateway.yml'],
    ['infra/k8s/nested.YML'],
    ['k8s/keep.yaml'],
    ['.github/workflows/ci.yaml'],
    ['.github/actions/build.yaml'],
    ['.github/notes.md', '# notes\n'],
    ['k8s-legacy/app.yml'],
    ['docs/plain.yml']
  ]

  test('змішане дерево — вивід, exit-код і стан ФС збігаються', async () => {
    await withTmpDir(dir => {
      const result = runBothOnTwin(dir, MIXED_FIXTURE)
      expectFullParity(result)
      expect(result.native.status).toBe(0)
      // Порядок — k8s (localeCompare: `_` перед `-`), тоді `.github`.
      expect(result.native.stdout).toBe(
        [
          'infra/k8s/nested.YML → infra/k8s/nested.yaml',
          'k8s/api_gateway.yml → k8s/api_gateway.yaml',
          'k8s/api-gateway.yml → k8s/api-gateway.yaml',
          'k8s/web.yml → k8s/web.yaml',
          '.github/actions/build.yaml → .github/actions/build.yml',
          '.github/workflows/ci.yaml → .github/workflows/ci.yml',
          ''
        ].join('\n')
      )
    })
  })

  test('--dry-run — префікс на кожному рядку, диск недоторканий', async () => {
    await withTmpDir(dir => {
      const result = runBothOnTwin(dir, MIXED_FIXTURE, ['--dry-run'])
      expectFullParity(result)
      expect(result.native.status).toBe(0)
      expect(
        result.native.stdout
          .split('\n')
          .filter(Boolean)
          .every(line => line.startsWith('[dry-run] '))
      ).toBe(true)
      expect(result.nativeTree).toEqual(snapshotTree(join(dir, 'js')))
      expect(result.nativeTree.some(entry => entry.startsWith('k8s/web.yml '))).toBe(true)
    })
  })

  test('немає що перейменовувати — однаковий текст і код 0', async () => {
    await withTmpDir(dir => {
      const result = runBothOnTwin(dir, [['docs/plain.yml'], ['k8s/keep.yaml']])
      expectFullParity(result)
      expect(result.native.status).toBe(0)
      expect(result.native.stdout).toBe(
        'Немає файлів для перейменування (k8s + .yml → .yaml; .github + .yaml → .yml).\n'
      )
    })
  })

  test('порожній корінь + --dry-run — префікс і на рядку «немає файлів»', async () => {
    await withTmpDir(dir => {
      const result = runBothOnTwin(dir, [], ['--dry-run'])
      expectFullParity(result)
      expect(result.native.stdout.startsWith('[dry-run] Немає файлів')).toBe(true)
    })
  })

  test('цільовий файл уже існує — stderr, код 1 і незмінений диск', async () => {
    await withTmpDir(dir => {
      const result = runBothOnTwin(dir, [['k8s/dup.yml', 'from\n'], ['k8s/dup.yaml', 'to\n'], ['k8s/ok.yml']])
      expectFullParity(result)
      expect(result.native.status).toBe(1)
      expect(result.native.stderr).toBe('  ❌ k8s/dup.yml → k8s/dup.yaml: цільовий файл уже існує, пропущено\n')
      expect(result.nativeTree).toContain('k8s/dup.yml from\n')
    })
  })

  test('`ignore` з .n-rules.json звужує обхід однаково', async () => {
    await withTmpDir(dir => {
      const result = runBothOnTwin(dir, [
        ['.n-rules.json', '{ "ignore": ["vendor", "../outside"] }\n'],
        ['k8s/app.yml'],
        ['vendor/k8s/app.yml']
      ])
      expectFullParity(result)
      expect(result.native.stdout).toBe('k8s/app.yml → k8s/app.yaml\n')
      expect(result.nativeTree).toContain('vendor/k8s/app.yml kind: Test\n')
    })
  })

  test('--root=<піддиректорія> — обхід лише піддерева', async () => {
    await withTmpDir(dir => {
      const result = runBothOnTwin(dir, [['sub/k8s/app.yml'], ['k8s/outside.yml']], ['--root=sub'])
      expectFullParity(result)
      expect(result.native.stdout).toBe('k8s/app.yml → k8s/app.yaml\n')
      expect(result.nativeTree).toContain('k8s/outside.yml kind: Test\n')
    })
  })

  test('ідемпотентність — другий прогін нічого не пише по обидва боки', async () => {
    await withTmpDir(dir => {
      const first = runBothOnTwin(dir, MIXED_FIXTURE)
      expectFullParity(first)
      const nativeSecond = runRulesCli(['rename-yaml-extensions'], join(dir, 'native'))
      const jsSecond = runJsCli(['rename-yaml-extensions'], join(dir, 'js'))
      expect(nativeSecond.stdout).toBe(jsSecond.stdout)
      expect(nativeSecond.status).toBe(jsSecond.status)
      expect(nativeSecond.stdout).toBe(
        'Немає файлів для перейменування (k8s + .yml → .yaml; .github + .yaml → .yml).\n'
      )
      expect(snapshotTree(join(dir, 'native'))).toEqual(first.nativeTree)
      expect(snapshotTree(join(dir, 'js'))).toEqual(first.jsTree)
    })
  })
})

describe('rules-cli: свідома розбіжність зрізу 2 — self-upgrade devDependencies', () => {
  test('JS-роутер мутує workspace-root package.json, native — ні', async () => {
    await withTmpDir(dir => {
      // `ensureNRulesInRootDevDependencies` спрацьовує ЛИШЕ на package.json із
      // полем `workspaces` — це поверхня sync/дистрибуції, не семантика
      // команди; native-шлях лишає read-only команду read-only (доккомент
      // `crates/rules-cli/src/skill_cmd.rs`).
      const pkg = '{\n  "name": "fixture",\n  "workspaces": ["packages/*"]\n}\n'
      const nativeRoot = join(dir, 'native')
      const jsRoot = join(dir, 'js')
      for (const root of [nativeRoot, jsRoot]) writeFixtureFile(root, 'package.json', pkg)

      const native = runRulesCli(['rename-yaml-extensions'], nativeRoot)
      const js = runJsCli(['rename-yaml-extensions'], jsRoot)

      expect(native.stdout).toBe(js.stdout)
      expect(native.status).toBe(js.status)
      expect(readFileSync(join(nativeRoot, 'package.json'), 'utf8')).toBe(pkg)
      expect(readFileSync(join(jsRoot, 'package.json'), 'utf8')).not.toBe(pkg)
      expect(js.stderr).toContain('@7n/rules')
      expect(native.stderr).toBe('')
    })
  })
})

/**
 * Готує git-фікстуру сервіс-орієнтованого репо: коміт, потім зміни в
 * робочому дереві (саме їх бачить дельта `ci plan`).
 * @param {string} dir tmpdir
 * @param {string} [config] вміст `.n-rules.json` (порожній рядок — без конфігу)
 * @returns {string} той самий dir
 */
function initCiFixture(dir, config = '{"rules":["text","doc-files"]}') {
  writeFixtureFile(dir, 'run/svc/a.js', 'export const a = 1\n')
  writeFixtureFile(dir, 'README.md', '# doc\n')
  writeFixtureFile(dir, 'tests/fixture.txt', 'x\n')
  if (config !== '') writeFixtureFile(dir, '.n-rules.json', config)
  initRepo(dir)
  writeFixtureFile(dir, 'run/svc/a.js', 'export const a = 2\n')
  writeFixtureFile(dir, 'run/svc/b.md', 'ok\n')
  return dir
}

/**
 * Ганяє `ci plan` обома CLI в одному каталозі й звіряє все, що видно ззовні.
 * `GITHUB_OUTPUT` роздільний, бо це append-файл — інакше другий прогін
 * дописував би до першого.
 * @param {string} dir корінь фікстури
 * @param {string[]} args аргументи після `ci`
 * @param {string} [ghDir] каталог для роздільних `$GITHUB_OUTPUT`
 * @returns {{ native: object, js: object }} результати обох боків
 */
function runCiPlanBoth(dir, args, ghDir) {
  const nativeEnv = { N_RULES_JS_ENTRY: JS_ENTRY }
  const jsEnv = {}
  if (ghDir) {
    mkdirSync(ghDir, { recursive: true })
    nativeEnv.GITHUB_OUTPUT = join(ghDir, 'native-output')
    jsEnv.GITHUB_OUTPUT = join(ghDir, 'js-output')
  }
  const native = runRulesCli(['ci', ...args], dir, nativeEnv)
  const js = spawnSync(execPath, [JS_ENTRY, 'ci', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...env, ...jsEnv }
  })
  expect(native.stdout).toBe(js.stdout)
  expect(native.stderr).toBe(js.stderr)
  expect(native.status).toBe(js.status)
  return { native, js }
}

describe('rules-cli parity: ci plan', () => {
  test('repo-wide дельта — людський вивід byte-exact', async () => {
    await withTmpDir(dir => {
      initCiFixture(dir)
      const { native } = runCiPlanBoth(dir, ['plan'])
      expect(native.status).toBe(0)
      expect(native.stdout).toContain('📋 ci plan (весь репозиторій): 2 змінених файлів у наборі')
      expect(native.stdout).toContain('any=true has_tests=true')
    })
  })

  test('--path <dir> — перетин піддерева з дельтою', async () => {
    await withTmpDir(dir => {
      initCiFixture(dir)
      const { native } = runCiPlanBoth(dir, ['plan', '--path', 'run/svc'])
      expect(native.status).toBe(0)
      expect(native.stdout).toContain('📋 ci plan (--path run/svc):')
    })
  })

  test('--json — порядок ключів і відступ як у JSON.stringify(plan, null, 2)', async () => {
    await withTmpDir(dir => {
      initCiFixture(dir)
      const { native } = runCiPlanBoth(dir, ['plan', '--json'])
      const parsed = JSON.parse(native.stdout)
      expect(Object.keys(parsed)).toEqual(['path', 'baseResolved', 'changedCount', 'hasChanges', 'hasTests', 'domains'])
      expect(native.stdout).toContain('\n  "path": null,')
    })
  })

  test('--azure — ##vso-рядки перед людським виводом', async () => {
    await withTmpDir(dir => {
      initCiFixture(dir)
      const { native } = runCiPlanBoth(dir, ['plan', '--azure'])
      expect(native.stdout).toContain('##vso[task.setvariable variable=any;isOutput=true]true')
      expect(native.stdout).toContain('##vso[task.setvariable variable=domains;isOutput=true][')
    })
  })

  test('--github — однаковий вміст $GITHUB_OUTPUT по обидва боки', async () => {
    await withTmpDir(dir => {
      const repo = join(dir, 'repo')
      initCiFixture(repo)
      runCiPlanBoth(repo, ['plan', '--github'], join(dir, 'gh'))
      const nativeOutput = readFileSync(join(dir, 'gh', 'native-output'), 'utf8')
      expect(nativeOutput).toBe(readFileSync(join(dir, 'gh', 'js-output'), 'utf8'))
      expect(nativeOutput).toContain('any=true\n')
      expect(nativeOutput.endsWith('\n')).toBe(true)
    })
  })

  test('--github без GITHUB_OUTPUT — та сама помилка й код 1', async () => {
    await withTmpDir(dir => {
      initCiFixture(dir)
      // Обидва боки успадковують env прогону — прибираємо змінну явно,
      // інакше сам запуск у GitHub Actions робив би кейс недосяжним.
      const cleanEnv = { ...env }
      delete cleanEnv.GITHUB_OUTPUT
      const native = spawnSync(resolveRulesCliBin(), ['ci', 'plan', '--github'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...cleanEnv, N_RULES_JS_ENTRY: JS_ENTRY }
      })
      const js = spawnSync(execPath, [JS_ENTRY, 'ci', 'plan', '--github'], {
        cwd: dir,
        encoding: 'utf8',
        env: cleanEnv
      })
      expect(native.stderr).toBe(js.stderr)
      expect(native.status).toBe(js.status)
      expect(native.status).toBe(1)
      expect(native.stderr).toContain('GITHUB_OUTPUT відсутня')
    })
  })

  test('порожній план — без конфігу жодне правило не enabled', async () => {
    await withTmpDir(dir => {
      initCiFixture(dir, '')
      const { native } = runCiPlanBoth(dir, ['plan'])
      expect(native.status).toBe(0)
      expect(native.stdout).toBe(
        '📋 ci plan (весь репозиторій): 2 змінених файлів у наборі\n  any=true has_tests=true\n'
      )
    })
  })

  test('правило з конфігу без каталогу — той самий warning у stderr', async () => {
    await withTmpDir(dir => {
      initCiFixture(dir, '{"rules":["text","такого-правила-немає"]}')
      const { native } = runCiPlanBoth(dir, ['plan'])
      expect(native.stderr).toContain('"такого-правила-немає" не знайдено НІ В ОДНОМУ з rulesDirs')
    })
  })

  test.each([
    ['неіснуючий каталог', ['plan', '--path', 'nope']],
    ['файл замість каталогу', ['plan', '--path', 'README.md']],
    ['вихід за межі кореня', ['plan', '--path', '../outside']],
    ['невідома підкоманда', ['nonsense']],
    ['підкоманда відсутня', []]
  ])('крайовий кейс (%s) — той самий stderr і код 1', async (_name, args) => {
    await withTmpDir(dir => {
      initCiFixture(dir)
      const { native } = runCiPlanBoth(dir, args)
      expect(native.status).toBe(1)
      expect(native.stdout).toBe('')
    })
  })

  test('битий .n-rules.json — делегація в JS дає byte-exact вихід', async () => {
    await withTmpDir(dir => {
      initCiFixture(dir, '{ зламаний')
      // Native не відтворює текст помилки рантайму, тому свідомо делегує;
      // runtime фіксуємо, інакше bun і node дають різні тексти JSON-помилки
      // (ризик 3 мінідизайну — розбіжність runtime-ів, не зрізу).
      const native = runRulesCli(['ci', 'plan'], dir, {
        N_RULES_JS_ENTRY: JS_ENTRY,
        N_RULES_JS_RUNTIME: execPath
      })
      const js = runJsCli(['ci', 'plan'], dir)
      expect(native.stderr).toBe(js.stderr)
      expect(native.status).toBe(js.status)
      expect(native.status).toBe(1)
    })
  })

  test('встановлений плагін вимикає native-шлях — команда делегується', async () => {
    await withTmpDir(dir => {
      initCiFixture(dir)
      writeFixtureFile(dir, 'node_modules/@7n/rules-lang-js/package.json', '{"name":"@7n/rules-lang-js"}')
      // Недосяжний runtime доводить САМ факт делегації: якби шлях лишався
      // native, прапорець нічого б не змінив.
      const delegated = runRulesCli(['ci', 'plan'], dir, {
        N_RULES_JS_ENTRY: JS_ENTRY,
        N_RULES_JS_RUNTIME: 'definitely-not-a-runtime'
      })
      expect(delegated.status).toBe(1)
      expect(delegated.stderr).toContain('не вдалося запустити definitely-not-a-runtime')
      // А з робочим runtime — звичайний byte-exact паритет.
      runCiPlanBoth(dir, ['plan'])
    })
  })
})
