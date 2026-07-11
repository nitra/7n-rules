/**
 * Тести Tauri-концерну `release` (tauri.mdc release):
 *   - silent skip коли в монорепо не знайдено жодного tauri.conf.json;
 *   - канонічний layout (change-файли → тег → release.yml, updater-конфіг) — чистий детектор;
 *   - кожна складова (createUpdaterArtifacts, pubkey, endpoints, workflow-файли, guard,
 *     permissions, порядок version-sync перед tauri-action) звітує окремою причиною при відхиленні;
 *   - T0-autofix доповнює вже існуючі файли канонічними ключами (idempotent), але НЕ
 *     скаффолдить відсутні файли й не чіпає pubkey/invalid-yaml.
 */
import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { lint } from '../main.mjs'
import { patterns } from '../fix-release.mjs'

const CHANGELOG_RELEASE_YML = `on:
  push:
    branches: [main]
    paths:
      - 'app/.changes/**'
  workflow_dispatch: {}
jobs:
  release:
    if: "!startsWith(github.event.head_commit.message, 'release:')"
    permissions:
      contents: write
      actions: write
    steps:
      - uses: actions/checkout@v6
      - name: Configure git identity + push auth
        run: |
          git config user.name "github-actions[bot]"
          git remote set-url origin "https://x-access-token:\${{ secrets.GITHUB_TOKEN }}@github.com/\${{ github.repository }}.git"
      - run: npx @nitra/cursor release
`

const RELEASE_YML = `on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build-desktop:
    steps:
      - name: Sync app version from tag
        run: |
          VER="\${GITHUB_REF_NAME#v}"
          node -e "sync tauri.conf.json version"
      - uses: tauri-apps/tauri-action@v0
`

const TAURI_CONF = JSON.stringify({
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey: 'abc123',
      endpoints: ['https://github.com/owner/repo/releases/latest/download/latest.json']
    }
  }
})

/**
 * Створює тимчасовий проєкт з опційним Tauri-layout-ом і canonical release-конфігом.
 * @param {{layout?: 'noTauri'|'canonical', tauriConf?: string, changelogReleaseYml?: string|null, releaseYml?: string|null}} [opts] параметри layout'а
 * @returns {{dir: string, cleanup: () => void}} шлях до проєкту і cleanup
 */
function makeProj({
  layout = 'canonical',
  tauriConf = TAURI_CONF,
  changelogReleaseYml = CHANGELOG_RELEASE_YML,
  releaseYml = RELEASE_YML
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tauri-release-'))
  if (layout === 'noTauri') {
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }
  mkdirSync(join(dir, 'app', 'src-tauri'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
  writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app', version: '0.0.0' }))
  writeFileSync(join(dir, 'app', 'src-tauri', 'tauri.conf.json'), tauriConf)
  mkdirSync(join(dir, 'app', '.changes'), { recursive: true })
  writeFileSync(join(dir, 'app', '.changes', '.gitkeep'), '')
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  if (changelogReleaseYml !== null) {
    writeFileSync(join(dir, '.github', 'workflows', 'changelog-release.yml'), changelogReleaseYml)
  }
  if (releaseYml !== null) {
    writeFileSync(join(dir, '.github', 'workflows', 'release.yml'), releaseYml)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * Викликає detector `lint(ctx)` без `process.chdir` (test.mdc canon).
 * @param {string} dir каталог проєкту
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]>} violations
 */
async function runCheckIn(dir) {
  const { violations } = await lint({ cwd: dir, ruleId: 'tauri', concernId: 'release', files: undefined })
  return violations
}

/**
 * Прогоняє T0-патерни concern-а над violations (як central fix-pipeline).
 * @param {import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення для фіксу
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<void>} завершується після застосування всіх патернів
 */
async function applyT0(violations, dir) {
  const ctx = {
    cwd: dir,
    ruleId: 'tauri',
    concernId: 'release',
    recordWrite() {
      // no-op: тест не відстежує записи fix-pipeline
    }
  }
  for (const p of patterns) {
    if (p.test(violations)) await p.apply(violations, ctx)
  }
}

/**
 * Ініціалізує тимчасовий git-репозиторій з GitHub-remote (для endpoint-виведення в T0).
 * @param {string} dir корінь проєкту
 * @returns {void}
 */
function initGitWithGithubRemote(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:owner/repo.git'], { cwd: dir })
}

describe('tauri release concern', () => {
  test('немає tauri.conf.json — silent skip', async () => {
    const proj = makeProj({ layout: 'noTauri' })
    expect(await runCheckIn(proj.dir)).toEqual([])
    proj.cleanup()
  })

  test('канонічний layout — детектор чистий', async () => {
    const proj = makeProj()
    expect(await runCheckIn(proj.dir)).toEqual([])
    proj.cleanup()
  })

  test('bundle.createUpdaterArtifacts відсутній — updater-artifacts-disabled', async () => {
    const proj = makeProj({ tauriConf: JSON.stringify({ bundle: {}, plugins: TAURI_CONF }) })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'updater-artifacts-disabled')).toBe(true)
    proj.cleanup()
  })

  test('plugins.updater.pubkey відсутній — updater-pubkey-missing', async () => {
    const proj = makeProj({
      tauriConf: JSON.stringify({
        bundle: { createUpdaterArtifacts: true },
        plugins: { updater: { endpoints: ['https://github.com/o/r/releases/latest/download/latest.json'] } }
      })
    })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'updater-pubkey-missing')).toBe(true)
    proj.cleanup()
  })

  test('plugins.updater.endpoints без latest.json — updater-endpoint-missing', async () => {
    const proj = makeProj({
      tauriConf: JSON.stringify({
        bundle: { createUpdaterArtifacts: true },
        plugins: { updater: { pubkey: 'abc', endpoints: ['https://example.com/other.json'] } }
      })
    })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'updater-endpoint-missing')).toBe(true)
    proj.cleanup()
  })

  test('changelog-release.yml відсутній — changelog-release-workflow-missing', async () => {
    const proj = makeProj({ changelogReleaseYml: null })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'changelog-release-workflow-missing')).toBe(true)
    proj.cleanup()
  })

  test('changelog-release.yml без paths на .changes/** — changelog-release-paths-missing', async () => {
    const broken = CHANGELOG_RELEASE_YML.replace("- 'app/.changes/**'", "- 'app/other/**'")
    const proj = makeProj({ changelogReleaseYml: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'changelog-release-paths-missing')).toBe(true)
    proj.cleanup()
  })

  test('changelog-release.yml без release: guard — changelog-release-no-guard', async () => {
    const broken = CHANGELOG_RELEASE_YML.replace(
      '    if: "!startsWith(github.event.head_commit.message, \'release:\')"\n',
      ''
    )
    const proj = makeProj({ changelogReleaseYml: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'changelog-release-no-guard')).toBe(true)
    proj.cleanup()
  })

  test('changelog-release.yml без actions: write — changelog-release-permissions-missing', async () => {
    const broken = CHANGELOG_RELEASE_YML.replace('      actions: write\n', '')
    const proj = makeProj({ changelogReleaseYml: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'changelog-release-permissions-missing')).toBe(true)
    proj.cleanup()
  })

  test('release.yml відсутній — release-workflow-missing', async () => {
    const proj = makeProj({ releaseYml: null })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'release-workflow-missing')).toBe(true)
    proj.cleanup()
  })

  test('release.yml без v* тригера — release-workflow-no-tag-trigger', async () => {
    const broken = RELEASE_YML.replace("tags: ['v*']", 'tags: []')
    const proj = makeProj({ releaseYml: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'release-workflow-no-tag-trigger')).toBe(true)
    proj.cleanup()
  })

  test('release.yml: sync версії після tauri-action — release-workflow-version-sync-order', async () => {
    const broken = `on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build-desktop:
    steps:
      - uses: tauri-apps/tauri-action@v0
      - name: Sync app version from tag
        run: node -e "sync tauri.conf.json version"
`
    const proj = makeProj({ releaseYml: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'release-workflow-version-sync-order')).toBe(true)
    proj.cleanup()
  })

  test('release.yml без sync-кроку взагалі — release-workflow-version-sync-order', async () => {
    const broken = `on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build-desktop:
    steps:
      - uses: tauri-apps/tauri-action@v0
`
    const proj = makeProj({ releaseYml: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'release-workflow-version-sync-order')).toBe(true)
    proj.cleanup()
  })
})

describe('tauri release T0 autofix', () => {
  test('bundle.createUpdaterArtifacts відсутній — T0 проставляє true', async () => {
    const proj = makeProj({ tauriConf: JSON.stringify({ bundle: {}, plugins: JSON.parse(TAURI_CONF).plugins }) })
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    const conf = JSON.parse(readFileSync(join(proj.dir, 'app', 'src-tauri', 'tauri.conf.json'), 'utf8'))
    expect(conf.bundle.createUpdaterArtifacts).toBe(true)
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'updater-artifacts-disabled')).toBe(false)
    proj.cleanup()
  })

  test('updater.endpoints відсутній — T0 виводить endpoint з git remote origin', async () => {
    const proj = makeProj({
      tauriConf: JSON.stringify({ bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: 'abc' } } })
    })
    initGitWithGithubRemote(proj.dir)
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    const conf = JSON.parse(readFileSync(join(proj.dir, 'app', 'src-tauri', 'tauri.conf.json'), 'utf8'))
    expect(conf.plugins.updater.endpoints).toContain(
      'https://github.com/owner/repo/releases/latest/download/latest.json'
    )
    proj.cleanup()
  })

  test('updater.pubkey відсутній — T0 НЕ фабрикує ключ, файл незмінний', async () => {
    const proj = makeProj({
      tauriConf: JSON.stringify({
        bundle: { createUpdaterArtifacts: true },
        plugins: { updater: { endpoints: ['https://github.com/o/r/releases/latest/download/latest.json'] } }
      })
    })
    const before = readFileSync(join(proj.dir, 'app', 'src-tauri', 'tauri.conf.json'), 'utf8')
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    expect(readFileSync(join(proj.dir, 'app', 'src-tauri', 'tauri.conf.json'), 'utf8')).toBe(before)
    proj.cleanup()
  })

  test('changelog-release.yml: T0 доповнює paths/dispatch/guard/permissions — idempotent', async () => {
    const bare = `on:
  push:
    branches: [main]
jobs:
  release:
    steps:
      - uses: actions/checkout@v6
`
    const proj = makeProj({ changelogReleaseYml: bare })
    const path = join(proj.dir, '.github', 'workflows', 'changelog-release.yml')
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    const parsed = parseYaml(readFileSync(path, 'utf8'))
    expect(parsed.on.push.paths).toContain('app/.changes/**')
    expect('workflow_dispatch' in parsed.on).toBe(true)
    expect(parsed.jobs.release.if).toContain('release:')
    expect(parsed.jobs.release.permissions).toEqual({ contents: 'write', actions: 'write' })
    expect(await runCheckIn(proj.dir)).toEqual([])

    const afterFirstFix = readFileSync(path, 'utf8')
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    expect(readFileSync(path, 'utf8')).toBe(afterFirstFix)
    proj.cleanup()
  })

  test('changelog-release.yml відсутній — T0 не скаффолдить файл', async () => {
    const proj = makeProj({ changelogReleaseYml: null })
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'changelog-release-workflow-missing')).toBe(true)
    proj.cleanup()
  })

  test('release.yml: T0 доповнює tags/dispatch і вставляє sync-крок перед tauri-action — idempotent', async () => {
    const bare = `on:
  push: {}
jobs:
  build-desktop:
    steps:
      - uses: tauri-apps/tauri-action@v0
`
    const proj = makeProj({ releaseYml: bare })
    const path = join(proj.dir, '.github', 'workflows', 'release.yml')
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    const parsed = parseYaml(readFileSync(path, 'utf8'))
    expect(parsed.on.push.tags).toContain('v*')
    expect('workflow_dispatch' in parsed.on).toBe(true)
    const stepUses = parsed.jobs['build-desktop'].steps.map(s => s.uses)
    const actionIdx = stepUses.indexOf('tauri-apps/tauri-action@v0')
    const syncIdx = parsed.jobs['build-desktop'].steps.findIndex(s => s.run?.includes('tauri.conf.json'))
    expect(syncIdx).toBeGreaterThanOrEqual(0)
    expect(syncIdx).toBeLessThan(actionIdx)
    expect(await runCheckIn(proj.dir)).toEqual([])

    const afterFirstFix = readFileSync(path, 'utf8')
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    expect(readFileSync(path, 'utf8')).toBe(afterFirstFix)
    proj.cleanup()
  })

  test('release.yml відсутній — T0 не скаффолдить файл', async () => {
    const proj = makeProj({ releaseYml: null })
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'release-workflow-missing')).toBe(true)
    proj.cleanup()
  })

  test('release.yml з невалідним YAML — T0 не чіпає файл', async () => {
    const proj = makeProj({ releaseYml: 'on: [broken\n' })
    const before = readFileSync(join(proj.dir, '.github', 'workflows', 'release.yml'), 'utf8')
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    expect(readFileSync(join(proj.dir, '.github', 'workflows', 'release.yml'), 'utf8')).toBe(before)
    proj.cleanup()
  })
})

describe('tauri release — push-auth / .gitkeep / zizmor-приглушення rust-cache', () => {
  const NO_AUTH_CHANGELOG_YML = `on:
  push:
    branches: [main]
    paths:
      - 'app/.changes/**'
  workflow_dispatch: {}
jobs:
  release:
    if: "!startsWith(github.event.head_commit.message, 'release:')"
    permissions:
      contents: write
      actions: write
    steps:
      - uses: actions/checkout@v6
      - run: npx @nitra/cursor release
`

  test('без remote set-url — changelog-release-push-auth-missing; T0 вставляє крок перед release-командою', async () => {
    const proj = makeProj({ changelogReleaseYml: NO_AUTH_CHANGELOG_YML })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'changelog-release-push-auth-missing')).toBe(true)

    await applyT0(violations, proj.dir)
    const path = join(proj.dir, '.github', 'workflows', 'changelog-release.yml')
    const parsed = parseYaml(readFileSync(path, 'utf8'))
    const steps = parsed.jobs.release.steps
    const authIdx = steps.findIndex(s => s.run?.includes('x-access-token'))
    const releaseIdx = steps.findIndex(s => s.run?.includes('@nitra/cursor release'))
    expect(authIdx).toBeGreaterThanOrEqual(0)
    expect(authIdx).toBeLessThan(releaseIdx)
    expect(await runCheckIn(proj.dir)).toEqual([])

    const afterFirstFix = readFileSync(path, 'utf8')
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    expect(readFileSync(path, 'utf8')).toBe(afterFirstFix)
    proj.cleanup()
  })

  test('без app/.changes/.gitkeep — changes-gitkeep-missing; T0 створює файл', async () => {
    const proj = makeProj()
    rmSync(join(proj.dir, 'app', '.changes', '.gitkeep'))
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'changes-gitkeep-missing')).toBe(true)

    await applyT0(violations, proj.dir)
    expect(readFileSync(join(proj.dir, 'app', '.changes', '.gitkeep'), 'utf8')).toBe('')
    expect(await runCheckIn(proj.dir)).toEqual([])
    proj.cleanup()
  })

  test('rust-cache без zizmor-приглушення — release-workflow-rust-cache-zizmor; T0 дописує коментар', async () => {
    const withCache = `on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build-desktop:
    steps:
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: app/src-tauri
      - name: Sync app version from tag
        run: |
          VER="\${GITHUB_REF_NAME#v}"
          node -e "sync tauri.conf.json version"
      - uses: tauri-apps/tauri-action@v0
`
    const proj = makeProj({ releaseYml: withCache })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'release-workflow-rust-cache-zizmor')).toBe(true)

    await applyT0(violations, proj.dir)
    const path = join(proj.dir, '.github', 'workflows', 'release.yml')
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('Swatinem/rust-cache@v2 # zizmor: ignore[cache-poisoning]')
    expect(await runCheckIn(proj.dir)).toEqual([])

    const afterFirstFix = raw
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    expect(readFileSync(path, 'utf8')).toBe(afterFirstFix)
    proj.cleanup()
  })
})
