/**
 * T0-autofix для `tauri/release` — детерміновані доповнення вже існуючих
 * канонічних файлів (tauri.conf.json, changelog-release.yml, release.yml).
 *
 * Свідомо НЕ створює файли з нуля (`*-workflow-missing`) і не чіпає
 * `*-invalid-yaml`/`tauri-conf-invalid-json`/`updater-pubkey-missing`:
 * реальний вміст release.yml/changelog-release.yml по чотирьох референс-репо
 * глибоко проєкт-специфічний (назви build-артефактів, Infisical project-slug/identity-id,
 * android-job) — правдоподібний, але вигаданий шаблон гірший за явну
 * mdc-вимогу зробити це вручну. pubkey — реальний ключ підпису, не для
 * автогенерації. Усі патерни читають вихідний файл і re-detect-ять стан
 * заново (idempotent), як cargo_mutants_config.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

import { parseDocument } from 'yaml'

import { parseWorkflowYaml, flattenWorkflowSteps, getStepRun, getStepUses } from '../../../scripts/lib/gha-workflow.mjs'
import { CHANGELOG_RELEASE_WORKFLOW, RELEASE_WORKFLOW, findTauriAppDirs, hasWorkflowDispatch } from './main.mjs'

const GITHUB_REMOTE_RE = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/u
const VERSION_WORD_RE = /version/iu

/**
 * Визначає `owner/repo` з `git remote get-url origin` (https чи ssh форма).
 * @param {string} cwd корінь репо
 * @returns {{owner: string, repo: string} | null} пара owner/repo або null, якщо не вдалось розпарсити
 */
function resolveGithubOwnerRepo(cwd) {
  const res = spawnSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
  if (res.status !== 0) return null
  const m = GITHUB_REMOTE_RE.exec(res.stdout.trim())
  return m ? { owner: m[1], repo: m[2] } : null
}

/**
 * Доповнює `tauri.conf.json` канонічними updater-полями (createUpdaterArtifacts, endpoints).
 * pubkey НЕ чіпаємо — реальний ключ підпису не генерується автоматично.
 * @param {string} cwd корінь репо
 * @returns {Promise<string[]>} абсолютні шляхи змінених файлів
 */
async function fixTauriConfFiles(cwd) {
  const apps = await findTauriAppDirs(cwd)
  const touched = []
  const ownerRepo = resolveGithubOwnerRepo(cwd)
  for (const app of apps) {
    let conf
    try {
      conf = JSON.parse(await readFile(app.tauriConfPath, 'utf8'))
    } catch {
      continue
    }
    let changed = false

    if (conf?.bundle?.createUpdaterArtifacts !== true) {
      conf.bundle = { ...conf.bundle, createUpdaterArtifacts: true }
      changed = true
    }

    const endpoints = conf?.plugins?.updater?.endpoints
    const hasLatestJsonEndpoint =
      Array.isArray(endpoints) &&
      endpoints.some(e => typeof e === 'string' && e.endsWith('/releases/latest/download/latest.json'))
    if (!hasLatestJsonEndpoint && ownerRepo) {
      const endpoint = `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/releases/latest/download/latest.json`
      conf.plugins = {
        ...conf.plugins,
        updater: { ...conf.plugins?.updater, endpoints: [...(Array.isArray(endpoints) ? endpoints : []), endpoint] }
      }
      changed = true
    }

    if (!changed) continue
    await writeFile(app.tauriConfPath, `${JSON.stringify(conf, null, 2)}\n`, 'utf8')
    touched.push(app.tauriConfPath)
  }
  return touched
}

/**
 * Доповнює `changelog-release.yml` канонічними ключами (paths, dispatch, guard, permissions)
 * — лише якщо файл вже існує й парситься; scaffold-з-нуля не робимо (див. header-коментар).
 * @param {string} cwd корінь репо
 * @returns {Promise<string[]>} абсолютні шляхи змінених файлів (0 чи 1 елемент)
 */
async function fixChangelogReleaseWorkflow(cwd) {
  const path = join(cwd, CHANGELOG_RELEASE_WORKFLOW)
  if (!existsSync(path)) return []
  const raw = await readFile(path, 'utf8')
  const parsedRoot = parseWorkflowYaml(raw)
  if (!parsedRoot) return []

  const apps = await findTauriAppDirs(cwd)
  const doc = parseDocument(raw)
  if (doc.errors?.length) return []
  let changed = false

  const paths = doc.getIn(['on', 'push', 'paths'])
  const expectedSuffixes = apps.map(a => {
    const prefix = a.ws === '.' ? '' : `${a.ws}/`
    return `${prefix}.changes/**`
  })
  const hasChangesPath =
    paths?.toJSON && Array.isArray(paths.toJSON()) && expectedSuffixes.some(s => paths.toJSON().includes(s))
  if (!hasChangesPath && expectedSuffixes.length > 0) {
    const seq = doc.createNode(
      Array.isArray(paths?.toJSON()) ? [...paths.toJSON(), expectedSuffixes[0]] : [expectedSuffixes[0]]
    )
    doc.setIn(['on', 'push', 'paths'], seq)
    changed = true
  }

  if (!hasWorkflowDispatch(parsedRoot)) {
    doc.setIn(['on', 'workflow_dispatch'], doc.createNode({}))
    changed = true
  }

  const jobIds = Object.keys(parsedRoot.jobs ?? {})
  const guardedJobId = jobIds.find(id => {
    const guard = parsedRoot.jobs[id]?.if
    return typeof guard === 'string' && guard.includes('head_commit.message') && guard.includes('release:')
  })
  const jobIdWithPermissions = jobIds.find(id => {
    const permissions = parsedRoot.jobs[id]?.permissions
    return permissions?.contents === 'write' && permissions?.actions === 'write'
  })
  const targetJobId = jobIds[0]
  if (targetJobId && !guardedJobId) {
    doc.setIn(['jobs', targetJobId, 'if'], "!startsWith(github.event.head_commit.message, 'release:')")
    changed = true
  }
  if (targetJobId && !jobIdWithPermissions) {
    doc.setIn(['jobs', targetJobId, 'permissions', 'contents'], 'write')
    doc.setIn(['jobs', targetJobId, 'permissions', 'actions'], 'write')
    changed = true
  }

  if (targetJobId && insertPushAuthStep(doc, parsedRoot, targetJobId)) changed = true

  if (!changed) return []
  await writeFile(path, doc.toString(), 'utf8')
  return [path]
}

/**
 * Вставляє канонічний push-auth крок перед першим run-кроком job-а (release-командою),
 * якщо його ще нема: checkout із persist-credentials: false (ga-канон; у checkout@v6 це
 * й дефолт) не лишає токена — release-push мовчки падає.
 * @param {import('yaml').Document} doc YAML-документ changelog-release.yml
 * @param {Record<string, unknown>} parsedRoot розпарсений workflow
 * @param {string} targetJobId job, куди вставляти крок
 * @returns {boolean} чи було вставлено крок
 */
function insertPushAuthStep(doc, parsedRoot, targetJobId) {
  const allSteps = flattenWorkflowSteps(parsedRoot)
  const hasPushAuth = allSteps.some(s => {
    const run = getStepRun(s.step)
    return run.includes('remote set-url') && run.includes('x-access-token')
  })
  if (hasPushAuth) return false
  const jobSteps = doc.getIn(['jobs', targetJobId, 'steps'])
  if (!jobSteps?.items) return false
  const authStep = doc.createNode({
    name: 'Configure git identity + push auth',
    run:
      'git config user.name "github-actions[bot]"\n' +
      'git config user.email "github-actions[bot]@users.noreply.github.com"\n' +
      `git remote set-url origin "https://x-access-token:\${{ secrets.GITHUB_TOKEN }}@github.com/\${{ github.repository }}.git"`
  })
  const steps = allSteps.filter(s => s.jobId === targetJobId)
  const firstRunIdx = steps.findIndex(s => getStepRun(s.step) !== '')
  jobSteps.items.splice(firstRunIdx === -1 ? jobSteps.items.length : firstRunIdx, 0, authStep)
  return true
}

/**
 * Створює `<ws>/.changes/.gitkeep` для кожного Tauri-застосунку — щоб paths-glob
 * релізного тригера матчив tracked-файл і після того, як реліз спожив change-файли.
 * @param {string} cwd корінь репо
 * @returns {Promise<string[]>} абсолютні шляхи створених файлів
 */
async function fixChangesGitkeep(cwd) {
  const apps = await findTauriAppDirs(cwd)
  const touched = []
  for (const app of apps) {
    const rel = app.ws === '.' ? '.changes/.gitkeep' : `${app.ws}/.changes/.gitkeep`
    const abs = join(cwd, rel)
    if (existsSync(abs)) continue
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, '', 'utf8')
    touched.push(abs)
  }
  return touched
}

/**
 * Додає `# zizmor: ignore[cache-poisoning]` до рядків `Swatinem/rust-cache` у release.yml —
 * текстова трансформація (коментарі не живуть у розпарсеному YAML), idempotent.
 * @param {string} cwd корінь репо
 * @returns {Promise<string[]>} абсолютні шляхи змінених файлів (0 чи 1 елемент)
 */
async function fixRustCacheZizmorIgnore(cwd) {
  const path = join(cwd, RELEASE_WORKFLOW)
  if (!existsSync(path)) return []
  const raw = await readFile(path, 'utf8')
  const lines = raw.split('\n')
  let changed = false
  const next = lines.map(line => {
    if (!line.includes('Swatinem/rust-cache') || line.includes('zizmor: ignore[cache-poisoning]')) return line
    changed = true
    return `${line.trimEnd()} # zizmor: ignore[cache-poisoning]`
  })
  if (!changed) return []
  await writeFile(path, next.join('\n'), 'utf8')
  return [path]
}

/**
 * Доповнює `release.yml` канонічними ключами (tags, dispatch, крок sync версії перед
 * `tauri-apps/tauri-action`) — лише якщо файл вже існує й парситься.
 * @param {string} cwd корінь репо
 * @returns {Promise<string[]>} абсолютні шляхи змінених файлів (0 чи 1 елемент)
 */
async function fixReleaseWorkflow(cwd) {
  const path = join(cwd, RELEASE_WORKFLOW)
  if (!existsSync(path)) return []
  const raw = await readFile(path, 'utf8')
  const parsedRoot = parseWorkflowYaml(raw)
  if (!parsedRoot) return []

  const apps = await findTauriAppDirs(cwd)
  const doc = parseDocument(raw)
  if (doc.errors?.length) return []
  let changed = false

  const tags = doc.getIn(['on', 'push', 'tags'])
  const hasTagTrigger = tags?.toJSON && Array.isArray(tags.toJSON()) && tags.toJSON().includes('v*')
  if (!hasTagTrigger) {
    doc.setIn(['on', 'push', 'tags'], doc.createNode([...(Array.isArray(tags?.toJSON()) ? tags.toJSON() : []), 'v*']))
    changed = true
  }

  if (!hasWorkflowDispatch(parsedRoot)) {
    doc.setIn(['on', 'workflow_dispatch'], doc.createNode({}))
    changed = true
  }

  const allSteps = flattenWorkflowSteps(parsedRoot)
  const jobIds = [...new Set(allSteps.map(s => s.jobId))]
  for (const jobId of jobIds) {
    const steps = allSteps.filter(s => s.jobId === jobId)
    const actionIdx = steps.findIndex(s => getStepUses(s.step).startsWith('tauri-apps/tauri-action'))
    if (actionIdx === -1) continue
    const syncIdx = steps.findIndex(
      s => getStepRun(s.step).includes('tauri.conf.json') && VERSION_WORD_RE.test(getStepRun(s.step))
    )
    if (syncIdx !== -1 && syncIdx < actionIdx) continue

    const app = apps[0]
    const tauriConfRel = app ? app.tauriConfPath.slice(cwd.length + 1) : 'src-tauri/tauri.conf.json'
    const syncStep = doc.createNode({
      name: 'Sync app version from tag',
      run: `VER="\${GITHUB_REF_NAME#v}"\nnode -e "const fs=require('fs');const f='${tauriConfRel}';const c=JSON.parse(fs.readFileSync(f));c.version=process.argv[1];fs.writeFileSync(f,JSON.stringify(c,null,2)+'\\n')" "$VER"`
    })
    const jobSteps = doc.getIn(['jobs', jobId, 'steps'])
    if (!jobSteps?.items) continue
    jobSteps.items.splice(actionIdx, 0, syncStep)
    changed = true
  }

  if (!changed) return []
  await writeFile(path, doc.toString(), 'utf8')
  return [path]
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'release-tauri-conf-canon',
    test: violations =>
      violations.some(v => v.reason === 'updater-artifacts-disabled' || v.reason === 'updater-endpoint-missing'),
    apply: async (_violations, ctx) => {
      const touchedFiles = await fixTauriConfFiles(ctx.cwd)
      for (const f of touchedFiles) ctx.recordWrite?.(f)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `tauri.conf.json updater-канон доповнено: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'release-changelog-release-augment',
    test: violations =>
      violations.some(v =>
        [
          'changelog-release-paths-missing',
          'changelog-release-no-dispatch',
          'changelog-release-no-guard',
          'changelog-release-permissions-missing',
          'changelog-release-push-auth-missing'
        ].includes(v.reason)
      ),
    apply: async (_violations, ctx) => {
      const touchedFiles = await fixChangelogReleaseWorkflow(ctx.cwd)
      for (const f of touchedFiles) ctx.recordWrite?.(f)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `${CHANGELOG_RELEASE_WORKFLOW}: канонічні ключі доповнено` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'release-release-workflow-augment',
    test: violations =>
      violations.some(v =>
        [
          'release-workflow-no-tag-trigger',
          'release-workflow-no-dispatch',
          'release-workflow-version-sync-order'
        ].includes(v.reason)
      ),
    apply: async (_violations, ctx) => {
      const touchedFiles = await fixReleaseWorkflow(ctx.cwd)
      for (const f of touchedFiles) ctx.recordWrite?.(f)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `${RELEASE_WORKFLOW}: канонічні ключі доповнено` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'release-changes-gitkeep',
    test: violations => violations.some(v => v.reason === 'changes-gitkeep-missing'),
    apply: async (_violations, ctx) => {
      const touchedFiles = await fixChangesGitkeep(ctx.cwd)
      for (const f of touchedFiles) ctx.recordWrite?.(f)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `.changes/.gitkeep створено: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'release-rust-cache-zizmor-ignore',
    test: violations => violations.some(v => v.reason === 'release-workflow-rust-cache-zizmor'),
    apply: async (_violations, ctx) => {
      const touchedFiles = await fixRustCacheZizmorIgnore(ctx.cwd)
      for (const f of touchedFiles) ctx.recordWrite?.(f)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `${RELEASE_WORKFLOW}: zizmor ignore[cache-poisoning] на rust-cache` }
        : { touchedFiles: [] }
    }
  }
]
