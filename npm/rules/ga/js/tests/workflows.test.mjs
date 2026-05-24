/**
 * Тести check-ga в ізольованих фікстурах: фокус на перевірці локального `shellcheck`.
 *
 * Реальний `shellcheck` ніколи не запускається — лише стаб у тимчасовому каталозі, доданому в `PATH`.
 */
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

import { check, checkShellcheckInstalled } from '../check.mjs'
import {
  ensureDir,
  withBinRemovedFromPath,
  withShellcheckStubInPath,
  withTmpCwd,
  writeJson
} from '../../../../../scripts/utils/test-helpers.mjs'

const BREW_INSTALL_SHELLCHECK_RE = /brew install shellcheck/

/**
 * Готує мінімальний макет проєкту з `.github/workflows/`, `.github/actions/setup-bun-deps/action.yml`,
 * `.github/zizmor.yml`, `.vscode/extensions.json` + `settings.json`, `package.json` зі скриптом `lint-ga`,
 * та канонічними workflow (`clean-ga-workflows.yml`, `clean-merged-branch.yml`, `lint-ga.yml`, `git-ai.yml`).
 *
 * Канонічних workflow тут достатньо тільки щоб увесь `check-ga` дійшов до перевірки `shellcheck`.
 * @returns {Promise<void>}
 */
async function setupCanonicalGaProject() {
  await ensureDir('.github/workflows')
  await ensureDir('.github/actions/setup-bun-deps')
  await ensureDir('.vscode')

  await writeJson('.vscode/extensions.json', { recommendations: ['github.vscode-github-actions'] })
  await writeJson('.vscode/settings.json', {
    '[github-actions-workflow]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' }
  })

  await writeJson('package.json', {
    name: 't',
    private: true,
    scripts: { 'lint-ga': 'n-cursor lint-ga' }
  })

  await writeFile(
    '.github/zizmor.yml',
    `rules:\n  unpinned-uses:\n    config:\n      policies:\n        '*': ref-pin\n`,
    'utf8'
  )

  await writeFile(
    '.github/actions/setup-bun-deps/action.yml',
    `name: setup-bun-deps\nruns:\n  using: composite\n  steps: []\n`,
    'utf8'
  )

  await writeFile(
    '.github/workflows/clean-ga-workflows.yml',
    `name: Clean action for removing completed workflow runs
on:
  schedule:
    - cron: '0 1 16 * *'
  workflow_dispatch: {}
concurrency:
  group: \${{ github.ref }}-\${{ github.workflow }}
  cancel-in-progress: true
jobs:
  cleanup_old_workflows:
    runs-on: ubuntu-latest
    permissions:
      actions: write
      contents: read
    steps:
      - name: Delete workflow runs
        uses: dmvict/clean-workflow-runs@v1
        with:
          token: \${{ github.token }}
          save_period: 31
          save_min_runs_number: 0
`,
    'utf8'
  )

  await writeFile(
    '.github/workflows/clean-merged-branch.yml',
    `name: Clean abandoned branches
on:
  schedule:
    - cron: '0 1 15 * *'
  workflow_dispatch: {}
concurrency:
  group: \${{ github.ref }}-\${{ github.workflow }}
  cancel-in-progress: true
jobs:
  cleanup_old_branches:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - id: delete_stuff
        name: Delete those pesky dead branches
        uses: phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3
        with:
          github_token: \${{ github.token }}
          last_commit_age_days: 90
          ignore_branches: main,dev
          dry_run: no
      - name: Get output
        env:
          DELETED_BRANCHES: \${{ steps.delete_stuff.outputs.deleted_branches }}
        run: |
          echo "Deleted branches: \${DELETED_BRANCHES}"
`,
    'utf8'
  )

  await writeFile(
    '.github/workflows/lint-ga.yml',
    `name: Lint GA
on:
  push:
    branches: [dev, main]
    paths:
      - '.github/actions/**'
      - '.github/workflows/**'
  pull_request:
    branches: [dev, main]
concurrency:
  group: \${{ github.ref }}-\${{ github.workflow }}
  cancel-in-progress: true
jobs:
  lint-ga:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup-bun-deps
      - uses: astral-sh/setup-uv@v8.0.0
      - name: Install conftest
        run: >-
          curl -fsSL
          https://github.com/open-policy-agent/conftest/releases/download/v0.62.0/conftest_0.62.0_Linux_x86_64.tar.gz
          | sudo tar -xz -C /usr/local/bin conftest
      - name: Lint GA
        run: bun run lint-ga
`,
    'utf8'
  )

  await writeFile(
    '.github/workflows/git-ai.yml',
    `name: Git AI
on:
  pull_request:
    types: [closed]
concurrency:
  group: \${{ github.ref }}-\${{ github.workflow }}
  cancel-in-progress: true
jobs:
  git-ai:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Install git-ai
        run: |
          curl -fsSL https://usegitai.com/install.sh | bash
      - name: Run git-ai
        run: |
          git-ai ci github run
`,
    'utf8'
  )

  // check-ga валідує `on.*.paths` через `git ls-files`; без git-репо ці перевірки падають,
  // тож ініціалізуємо порожнє локальне репо й трекаємо щойно створені файли.

  execFileSync('git', ['init', '-q', '--initial-branch=main'])

  execFileSync('git', ['add', '-A'])
}

describe('check-ga: shellcheck в PATH', () => {
  test('exit 0, коли shellcheck доступний у PATH', async () => {
    await withTmpCwd(async () => {
      await setupCanonicalGaProject()
      await withShellcheckStubInPath(async () => {
        expect(await check()).toBe(0)
      })
    })
  })

  // Точковий тест на `checkShellcheckInstalled` — викликаємо предикат напряму. Раніше тест ганяв
  // увесь `check()`, але після Plan B-рефактору `check()` починає з batched conftest, а
  // `withBinRemovedFromPath('shellcheck')` на macOS видаляє `/opt/homebrew/bin` (де живуть і
  // shellcheck, і conftest), тож conftest зникає й `runConftestBatch` падає до `checkShellcheckInstalled`.
  // Точкова перевірка обходить цю проблему.
  test('checkShellcheckInstalled — fail + повідомлення про shellcheck/brew, коли його немає', async () => {
    await withBinRemovedFromPath('shellcheck', () => {
      const passes = []
      const fails = []
      checkShellcheckInstalled(
        m => passes.push(m),
        m => fails.push(m)
      )
      expect(passes).toEqual([])
      expect(fails.length).toBe(1)
      expect(fails[0]).toContain('shellcheck')
      expect(fails[0]).toMatch(BREW_INSTALL_SHELLCHECK_RE)
    })
  })
})
