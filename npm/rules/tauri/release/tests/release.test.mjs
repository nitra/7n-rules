/**
 * Тести Tauri-концерну `release` (tauri.mdc release):
 *   - silent skip коли в монорепо не знайдено жодного tauri.conf.json;
 *   - канонічний layout (change-файли → тег → release.yml, updater-конфіг) — чистий детектор;
 *   - кожна складова (createUpdaterArtifacts, pubkey, endpoints, workflow-файли, guard,
 *     permissions, порядок version-sync перед tauri-action) звітує окремою причиною при відхиленні;
 *
 * T0-autofix БІЛЬШЕ НЕ ТУТ: фікс портовано нативно (§2.97,
 * `crates/rules-core/src/concerns/fix_tauri_release.rs`), і його сценарії
 * переїхали туди ж Rust-тестами — включно з двома, які найлегше зламати
 * непомітно: вставка version-sync кроку ПЕРЕД `tauri-action` і виживання
 * коментарів чужого workflow. Тут лишається лише детекторна половина.
 *
 * Детектор (`lint`) — через `runConcernDetector` (dispatch-рівень), не пряма
 * функція: JS `main.mjs` видалений (I1 фази 5 батчу 4, YAML-кластер частина 2),
 * concern тепер живе лише в `crates/rules-core/src/concerns/tauri_release.rs`.
 */
import { describe, expect, test } from 'vitest'
import { dirname, join } from 'node:path'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }
const lint = ctx => runConcernDetector(CONCERN, ctx)

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
      - run: npx @7n/rules release
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
