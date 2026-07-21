/** @see ./docs/main.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { collectInScopeVuePackages } from '../scope/main.mjs'
import { missingMarkers } from '../scaffold/main.mjs'

/** Repo-relative шлях канонічного composite action (не per-package — один на репозиторій). */
export const PLAYWRIGHT_ACTION_REL = '.github/actions/setup-playwright-chromium/action.yml'

/** Repo-relative шлях канонічного workflow, що запускає `vitest --project=storybook`. */
export const STORYBOOK_WORKFLOW_REL = '.github/workflows/lint-storybook.yml'

/**
 * Маркери канону composite action `setup-playwright-chromium` (ADR Кластер 5): кеш
 * `ms-playwright` через `actions/cache`, ключ від версії playwright, install лише chromium.
 * Текстовий пошук — той самий підхід, що й `MAIN_JS_MARKERS`/`PREVIEW_JS_MARKERS` у `scaffold`.
 */
export const PLAYWRIGHT_ACTION_MARKERS = [
  { token: 'ms-playwright', hint: 'кеш каталогу ms-playwright' },
  { token: 'actions/cache@', hint: 'actions/cache для Playwright-браузерів' },
  { token: 'playwright install chromium', hint: 'install лише chromium (не всі браузери)' }
]

/**
 * Маркери канону `.github/workflows/lint-storybook.yml`: композитний Playwright-кеш ПІСЛЯ
 * setup-bun-deps, і швидкий `vitest --project=storybook` (ADR Кластер 5 — nightly-only
 * `@7n/test coverage`/mutation-testing на PR не запускається, лише цей швидкий шлях).
 */
export const STORYBOOK_WORKFLOW_MARKERS = [
  { token: './.github/actions/setup-bun-deps', hint: 'setup-bun-deps перед Playwright-кроком' },
  { token: './.github/actions/setup-playwright-chromium', hint: 'композитний Playwright-кеш' },
  { token: '--project=storybook', hint: 'швидкий прогін лише storybook-проєкту (не повний coverage)' }
]

/**
 * Перевіряє один репо-рівневий канонічний файл (composite action чи workflow): відсутність →
 * `missingReason`-порушення з посиланням на `npx \@7n/rules fix storybook`; присутність без
 * якогось маркера → `markerReason`-порушення на конкретний маркер. Той самий патерн, що й
 * `checkCanonFile` у `scaffold/main.mjs`, але без per-package `rootDir` — файл один на репо.
 * @param {string} cwd абсолютний корінь репозиторію
 * @param {string} relFile posix-relative шлях файлу від кореня репозиторію
 * @param {{ token: string, hint: string }[]} markers канонічні маркери файлу
 * @param {string} missingReason reason для порушення "файл відсутній"
 * @param {string} markerReason reason для порушення "маркер відсутній"
 * @param {ReturnType<typeof createViolationReporter>} reporter reporter поточного лінту
 * @returns {Promise<void>}
 */
async function checkRepoCanonFile(cwd, relFile, markers, missingReason, markerReason, reporter) {
  const abs = join(cwd, relFile)
  if (existsSync(abs)) {
    const content = await readFile(abs, 'utf8')
    for (const m of missingMarkers(content, markers)) {
      reporter.fail(`${relFile} не відповідає канону — бракує: ${m.hint} (storybook.mdc, ADR Кластер 5)`, {
        reason: markerReason,
        file: relFile
      })
    }
    return
  }
  reporter.fail(
    `Відсутній ${relFile} — канонічний Playwright-кеш для vitest storybook-проєкту: npx @7n/rules fix storybook (storybook.mdc, ADR Кластер 5)`,
    { reason: missingReason, file: relFile }
  )
}

/**
 * Detector concern-а `storybook/ci` (ADR Кластер 5, CI-частина): для репозиторіїв з бодай
 * одним Vue component library пакетом у скоупі Storybook (`collectInScopeVuePackages`) —
 * канонічний composite action `setup-playwright-chromium` (кеш Playwright-браузерів, лише
 * chromium) і канонічний `.github/workflows/lint-storybook.yml`, що запускає швидкий
 * `vitest --project=storybook` на PR. Гейтований `requires.capability: ci:github` — спить
 * у репозиторіях без плагіна `@7n/rules-ci-github` (немає `.github/workflows`).
 *
 * Nightly-only `@7n/test coverage` (mutation testing) — поза обсягом цього concern-а: ADR
 * Кластер 5 явно розділяє швидкий PR-шлях (цей concern) і nightly mutation-прогін, який
 * лишається окремою інфраструктурою `test/stryker_config`.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат лінту
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const cwd = ctx.cwd

  const pkgs = await collectInScopeVuePackages(cwd)
  if (pkgs.length === 0) {
    reporter.pass('storybook/ci: немає Vue component library пакетів у скоупі (storybook.mdc)')
    return reporter.result()
  }

  await checkRepoCanonFile(
    cwd,
    PLAYWRIGHT_ACTION_REL,
    PLAYWRIGHT_ACTION_MARKERS,
    'missing-playwright-action',
    'playwright-action-marker-missing',
    reporter
  )

  await checkRepoCanonFile(
    cwd,
    STORYBOOK_WORKFLOW_REL,
    STORYBOOK_WORKFLOW_MARKERS,
    'missing-storybook-workflow',
    'storybook-workflow-marker-missing',
    reporter
  )

  return reporter.result()
}
