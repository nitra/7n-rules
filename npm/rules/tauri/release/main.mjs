/** @see ./docs/release.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { flattenWorkflowSteps, getStepRun, getStepUses, parseWorkflowYaml } from '../../../scripts/lib/gha-workflow.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { getMonorepoPackageRootDirs } from '../../../scripts/lib/workspaces.mjs'

const CHANGELOG_RELEASE_WORKFLOW = '.github/workflows/changelog-release.yml'
const RELEASE_WORKFLOW = '.github/workflows/release.yml'
const VERSION_WORD_RE = /version/iu

/**
 * Знаходить workspace-каталоги з Tauri-застосунком (`<ws>/src-tauri/tauri.conf.json` чи legacy `<ws>/tauri.conf.json`).
 * @param {string} cwd корінь репо
 * @returns {Promise<{ws: string, tauriConfPath: string}[]>} знайдені застосунки
 */
async function findTauriAppDirs(cwd) {
  const roots = await getMonorepoPackageRootDirs(cwd)
  const found = []
  for (const ws of roots) {
    const base = ws === '.' ? cwd : join(cwd, ws)
    const nested = join(base, 'src-tauri', 'tauri.conf.json')
    const flat = join(base, 'tauri.conf.json')
    if (existsSync(nested)) found.push({ ws, tauriConfPath: nested })
    else if (existsSync(flat)) found.push({ ws, tauriConfPath: flat })
  }
  return found
}

/**
 * Чи `on.workflow_dispatch` присутній у корені workflow.
 * @param {Record<string, unknown> | null} root корінь workflow
 * @returns {boolean} true, якщо ключ присутній (значення може бути `{}`)
 */
function hasWorkflowDispatch(root) {
  const on = root?.on
  return Boolean(on && typeof on === 'object' && 'workflow_dispatch' in on)
}

/**
 * Перевіряє `tauri.conf.json` одного застосунку на updater-готовність bundle-секції.
 * @param {{ws: string, tauriConfPath: string}} app застосунок
 * @param {string} cwd корінь репо
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkTauriConf(app, cwd, reporter) {
  const rel = app.tauriConfPath.slice(cwd.length + 1)
  let conf
  try {
    conf = JSON.parse(await readFile(app.tauriConfPath, 'utf8'))
  } catch {
    reporter.fail(`${rel}: не вдалося розпарсити JSON (tauri.mdc release)`, {
      reason: 'tauri-conf-invalid-json',
      file: rel
    })
    return
  }

  if (conf?.bundle?.createUpdaterArtifacts === true) {
    reporter.pass(`${rel}: bundle.createUpdaterArtifacts: true`)
  } else {
    reporter.fail(
      `${rel}: bundle.createUpdaterArtifacts має бути true — інакше release-білд не публікує updater-артефакти (tauri.mdc release)`,
      { reason: 'updater-artifacts-disabled', file: rel }
    )
  }

  const pubkey = conf?.plugins?.updater?.pubkey
  const hasPubkey = typeof pubkey === 'string' && pubkey.trim() !== ''
  if (hasPubkey) {
    reporter.pass(`${rel}: plugins.updater.pubkey заданий`)
  } else {
    reporter.fail(
      `${rel}: plugins.updater.pubkey відсутній — автооновлення не запуститься без публічного ключа (tauri.mdc release)`,
      { reason: 'updater-pubkey-missing', file: rel }
    )
  }

  const endpoints = conf?.plugins?.updater?.endpoints
  const hasLatestJsonEndpoint =
    Array.isArray(endpoints) &&
    endpoints.some(e => typeof e === 'string' && e.endsWith('/releases/latest/download/latest.json'))
  if (hasLatestJsonEndpoint) {
    reporter.pass(`${rel}: plugins.updater.endpoints вказує на latest.json`)
  } else {
    reporter.fail(
      `${rel}: plugins.updater.endpoints має містити ".../releases/latest/download/latest.json" (tauri.mdc release)`,
      { reason: 'updater-endpoint-missing', file: rel }
    )
  }
}

/**
 * Перевіряє `changelog-release.yml`: тригер на change-файли, guard від release-циклу, права.
 * @param {string} cwd корінь репо
 * @param {{ws: string}[]} apps знайдені Tauri-застосунки (для звірки `on.push.paths`)
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkChangelogReleaseWorkflow(cwd, apps, reporter) {
  const path = join(cwd, CHANGELOG_RELEASE_WORKFLOW)
  if (!existsSync(path)) {
    reporter.fail(
      `${CHANGELOG_RELEASE_WORKFLOW} відсутній — канонічний release-flow вимагає push-тригер на <app>/.changes/** (tauri.mdc release)`,
      { reason: 'changelog-release-workflow-missing', file: CHANGELOG_RELEASE_WORKFLOW }
    )
    return
  }
  const root = parseWorkflowYaml(await readFile(path, 'utf8'))
  if (!root) {
    reporter.fail(`${CHANGELOG_RELEASE_WORKFLOW}: YAML не вдалося розібрати (tauri.mdc release)`, {
      reason: 'changelog-release-workflow-invalid-yaml',
      file: CHANGELOG_RELEASE_WORKFLOW
    })
    return
  }

  const paths = /** @type {unknown} */ (root?.on)?.push?.paths
  const expectedSuffixes = apps.map(a => {
    const prefix = a.ws === '.' ? '' : `${a.ws}/`
    return `${prefix}.changes/**`
  })
  const hasChangesPath = Array.isArray(paths) && expectedSuffixes.some(suffix => paths.includes(suffix))
  if (hasChangesPath) {
    reporter.pass(`${CHANGELOG_RELEASE_WORKFLOW}: on.push.paths містить */.changes/**`)
  } else {
    reporter.fail(
      `${CHANGELOG_RELEASE_WORKFLOW}: on.push.paths має містити "<app>/.changes/**" (tauri.mdc release, n-changelog.mdc)`,
      { reason: 'changelog-release-paths-missing', file: CHANGELOG_RELEASE_WORKFLOW }
    )
  }

  if (hasWorkflowDispatch(root)) {
    reporter.pass(`${CHANGELOG_RELEASE_WORKFLOW}: workflow_dispatch присутній`)
  } else {
    reporter.fail(`${CHANGELOG_RELEASE_WORKFLOW}: бракує workflow_dispatch: {} (tauri.mdc release)`, {
      reason: 'changelog-release-no-dispatch',
      file: CHANGELOG_RELEASE_WORKFLOW
    })
  }

  const jobs = root?.jobs && typeof root.jobs === 'object' ? Object.values(root.jobs) : []
  const hasReleaseGuard = jobs.some(job => {
    const guard = /** @type {{if?: unknown}} */ (job)?.if
    return typeof guard === 'string' && guard.includes('head_commit.message') && guard.includes('release:')
  })
  if (hasReleaseGuard) {
    reporter.pass(`${CHANGELOG_RELEASE_WORKFLOW}: guard від release-циклу присутній`)
  } else {
    reporter.fail(
      `${CHANGELOG_RELEASE_WORKFLOW}: job без guard "!startsWith(github.event.head_commit.message, 'release:')" — ризик циклу (tauri.mdc release)`,
      { reason: 'changelog-release-no-guard', file: CHANGELOG_RELEASE_WORKFLOW }
    )
  }

  const hasWritePermissions = jobs.some(job => {
    const permissions = /** @type {{permissions?: {contents?: string, actions?: string}}} */ (job)?.permissions
    return permissions?.contents === 'write' && permissions?.actions === 'write'
  })
  if (hasWritePermissions) {
    reporter.pass(`${CHANGELOG_RELEASE_WORKFLOW}: contents:write + actions:write присутні`)
  } else {
    reporter.fail(
      `${CHANGELOG_RELEASE_WORKFLOW}: job має мати permissions.contents: write і permissions.actions: write (для dispatch release.yml) (tauri.mdc release)`,
      { reason: 'changelog-release-permissions-missing', file: CHANGELOG_RELEASE_WORKFLOW }
    )
  }
}

/**
 * Перевіряє `release.yml`: тригер на теги, dispatch, sync версії перед `tauri-action`.
 * @param {string} cwd корінь репо
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер концерну
 * @returns {Promise<void>} завершується після перевірки
 */
async function checkReleaseWorkflow(cwd, reporter) {
  const path = join(cwd, RELEASE_WORKFLOW)
  if (!existsSync(path)) {
    reporter.fail(
      `${RELEASE_WORKFLOW} відсутній — build/publish DMG й updater-артефактів вимагає канонічний release.yml (tauri.mdc release)`,
      { reason: 'release-workflow-missing', file: RELEASE_WORKFLOW }
    )
    return
  }
  const root = parseWorkflowYaml(await readFile(path, 'utf8'))
  if (!root) {
    reporter.fail(`${RELEASE_WORKFLOW}: YAML не вдалося розібрати (tauri.mdc release)`, {
      reason: 'release-workflow-invalid-yaml',
      file: RELEASE_WORKFLOW
    })
    return
  }

  const tags = /** @type {unknown} */ (root?.on)?.push?.tags
  const hasTagTrigger = Array.isArray(tags) && tags.includes('v*')
  if (hasTagTrigger) {
    reporter.pass(`${RELEASE_WORKFLOW}: on.push.tags містить v*`)
  } else {
    reporter.fail(`${RELEASE_WORKFLOW}: on.push.tags має містити "v*" (tauri.mdc release)`, {
      reason: 'release-workflow-no-tag-trigger',
      file: RELEASE_WORKFLOW
    })
  }

  if (hasWorkflowDispatch(root)) {
    reporter.pass(`${RELEASE_WORKFLOW}: workflow_dispatch присутній`)
  } else {
    reporter.fail(
      `${RELEASE_WORKFLOW}: бракує workflow_dispatch: {} — без нього changelog-release.yml не може викликати dispatch білда (tauri.mdc release)`,
      { reason: 'release-workflow-no-dispatch', file: RELEASE_WORKFLOW }
    )
  }

  const allSteps = flattenWorkflowSteps(root)
  const jobIds = [...new Set(allSteps.map(s => s.jobId))]
  for (const jobId of jobIds) {
    const steps = allSteps.filter(s => s.jobId === jobId)
    const actionIdx = steps.findIndex(s => getStepUses(s.step).startsWith('tauri-apps/tauri-action'))
    if (actionIdx === -1) continue
    const syncIdx = steps.findIndex(
      s => getStepRun(s.step).includes('tauri.conf.json') && VERSION_WORD_RE.test(getStepRun(s.step))
    )
    const syncBeforeAction = syncIdx !== -1 && syncIdx < actionIdx
    if (syncBeforeAction) {
      reporter.pass(`${RELEASE_WORKFLOW}: job "${jobId}" — sync версії йде перед tauri-action`)
    } else {
      reporter.fail(
        `${RELEASE_WORKFLOW}: job "${jobId}" — крок sync версії в tauri.conf.json з тегу має йти перед tauri-apps/tauri-action (tauri.mdc release)`,
        { reason: 'release-workflow-version-sync-order', file: RELEASE_WORKFLOW }
      )
    }
  }
}

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const apps = await findTauriAppDirs(cwd)
  if (apps.length === 0) {
    return reporter.result()
  }

  for (const app of apps) {
    await checkTauriConf(app, cwd, reporter)
  }
  await checkChangelogReleaseWorkflow(cwd, apps, reporter)
  await checkReleaseWorkflow(cwd, reporter)

  return reporter.result()
}
