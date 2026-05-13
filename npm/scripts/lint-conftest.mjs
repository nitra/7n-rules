/**
 * Прогоняє `conftest test` по всіх Rego-полісі з `npm/policy/` (окрім `ga/*`,
 * які вже виконуються через `lint-ga.mjs`).
 *
 * Кожна полісі має свій namespace, опційний `rule` (id у `.n-cursor.json:rules`,
 * інакше таргет пропускається — як гейтинг у `check-*.mjs`), і список цільових
 * файлів — single-file або walk-предикат для дерева. Якщо цільових файлів немає
 * або правило не активне — таргет мовчки пропускається.
 *
 * Поведінка fallback:
 *  - якщо `conftest` не в `PATH` — друкуємо `ℹ` повідомлення з підказкою
 *    встановлення і повертаємо 0 (структурні JS-перевірки в `check-*.mjs`
 *    лишаються паралельно). Те саме рішення — у `lint-ga.mjs`.
 *  - якщо `npm/policy/` не існує (нетипова інсталяція) — також `ℹ` skip.
 *
 * Перший ненульовий exit-код conftest — повертаємо як результат, але всі
 * наступні таргети все одно виконуємо, щоб одразу побачити повний список
 * порушень (а не виправляти по одному).
 *
 * Експортовано окремо `runLintConftestCli` — використовується з
 * `bin/n-cursor.js` як підкоманда `lint-conftest`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveCmd } from './utils/resolve-cmd.mjs'

/** Каталог пакету `@nitra/cursor`, від якого ресолвимо вшиту директорію policy/. */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Шлях до кореня Rego-полісі. У npm-tarball публікується через `files: ["policy"]`. */
const POLICY_DIR = join(PACKAGE_ROOT, 'policy')

/**
 * Опис одного таргета: namespace + спосіб розвʼязати цільові файли.
 *
 * `single` — конкретний файл відносно cwd, перевіряється `existsSync`-ом.
 * `walk` — рекурсивний обхід від cwd із простим суфікс-предикатом
 * (наприклад `name === 'package.json'`). Глибокі ігнори — як у `walkDir`
 * в інших скриптах: `node_modules`, `.git`, `dist`, `coverage`, `build`,
 * `.turbo`, `.next`. Не використовуємо bun Glob, щоб не плодити залежності
 * за межами `node:fs`.
 * @typedef {{
 *   namespace: string,
 *   policyDir: string,
 *   rule?: string,
 *   single?: string,
 *   walk?: { match: (relPosix: string) => boolean }
 * }} ConftestTarget
 */

/**
 * Зчитує `rules` з `.n-cursor.json` у cwd. Повертає множину рядків — або `null`,
 * якщо файлу немає чи поле некоректне (тоді гейтинг вимикаємо — як у `check-bun.mjs`).
 * @param {string} cwd корінь репо
 * @returns {Set<string> | null} множина активних правил або null
 */
function loadActiveCursorRules(cwd) {
  const path = join(cwd, '.n-cursor.json')
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(raw?.rules)) return null
    return new Set(raw.rules.map(String))
  } catch {
    return null
  }
}

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage', 'build', '.turbo', '.next'])

/** `…/k8s/<env>/configmap.yaml` (configmap безпосередньо у directory `k8s/<…>`). */
const K8S_CONFIGMAP_PATH_RE = /(^|\/)k8s\/[^/]+\/configmap\.yaml$/u
/** Будь-який шлях під сегментом `k8s/`. */
const K8S_DIR_PATH_RE = /(^|\/)k8s\//u
/** `…/k8s/<…>/hc.yaml` (HealthCheckPolicy будь-де під k8s). */
const K8S_HC_YAML_PATH_RE = /(^|\/)k8s\/.+\/hc\.yaml$/u
/** `…/k8s/…/base/…/hr.yaml` (HTTPRoute у base-шарі). */
const K8S_BASE_HR_YAML_PATH_RE = /(^|\/)k8s\/.*base\/.*hr\.yaml$/u
/** Будь-який ресурсний YAML під `…/k8s/.../base/...` (для abie.base_deployment_preem). */
const K8S_BASE_RESOURCE_PATH_RE = /(^|\/)k8s\/.*base\//u
/** `kustomization.yaml` будь-де під сегментом `k8s/`. */
const K8S_KUSTOMIZATION_PATH_RE = /(^|\/)k8s\/.*\/kustomization\.yaml$/u
/** `…/k8s/.../base/.../kustomization.yaml`. */
const K8S_BASE_KUSTOMIZATION_PATH_RE = /(^|\/)k8s\/.*base\/(?:.*\/)?kustomization\.yaml$/u
/** Будь-який ресурсний `*.yaml` під сегментом `…/k8s/.../base/...`, окрім `kustomization.yaml`. */
const K8S_BASE_MANIFEST_PATH_RE = /(^|\/)k8s\/.*base\//u
/** `…/k8s/.../svc.yaml` (cluster-IP Service). */
const K8S_SVC_YAML_PATH_RE = /(^|\/)k8s\/.+\/svc\.yaml$/u
/** `…/k8s/.../svc-hl.yaml` (headless Service). */
const K8S_SVC_HL_YAML_PATH_RE = /(^|\/)k8s\/.+\/svc-hl\.yaml$/u

/** @type {ConftestTarget[]} */
const TARGETS = [
  // ── bun ─────────────────────────────────────────────────────────────────
  { namespace: 'bun.bunfig', policyDir: 'bun', rule: 'bun', single: 'bunfig.toml' },
  { namespace: 'bun.package_json', policyDir: 'bun', rule: 'bun', single: 'package.json' },

  // ── text ────────────────────────────────────────────────────────────────
  { namespace: 'text.oxfmtrc', policyDir: 'text', rule: 'text', single: '.oxfmtrc.json' },
  { namespace: 'text.cspell', policyDir: 'text', rule: 'text', single: '.cspell.json' },
  { namespace: 'text.markdownlint', policyDir: 'text', rule: 'text', single: '.markdownlint-cli2.jsonc' },
  { namespace: 'text.package_json', policyDir: 'text', rule: 'text', single: 'package.json' },

  // ── style-lint ──────────────────────────────────────────────────────────
  { namespace: 'style_lint.package_json', policyDir: 'style_lint', rule: 'style-lint', single: 'package.json' },
  {
    namespace: 'style_lint.lint_style_yml',
    policyDir: 'style_lint',
    rule: 'style-lint',
    single: '.github/workflows/lint-style.yml'
  },
  {
    namespace: 'style_lint.vscode_extensions',
    policyDir: 'style_lint',
    rule: 'style-lint',
    single: '.vscode/extensions.json'
  },
  {
    namespace: 'style_lint.vscode_settings',
    policyDir: 'style_lint',
    rule: 'style-lint',
    single: '.vscode/settings.json'
  },

  // ── php ─────────────────────────────────────────────────────────────────
  { namespace: 'php.package_json', policyDir: 'php', rule: 'php', single: 'package.json' },
  {
    namespace: 'php.lint_php_yml',
    policyDir: 'php',
    rule: 'php',
    single: '.github/workflows/lint-php.yml'
  },

  // ── npm-module ──────────────────────────────────────────────────────────
  {
    namespace: 'npm_module.root_package_json',
    policyDir: 'npm_module',
    rule: 'npm-module',
    single: 'package.json'
  },
  {
    namespace: 'npm_module.npm_package_json',
    policyDir: 'npm_module',
    rule: 'npm-module',
    single: 'npm/package.json'
  },
  {
    namespace: 'npm_module.emit_types_config',
    policyDir: 'npm_module',
    rule: 'npm-module',
    single: 'npm/tsconfig.emit-types.json'
  },
  {
    namespace: 'npm_module.npm_publish_yml',
    policyDir: 'npm_module',
    rule: 'npm-module',
    single: '.github/workflows/npm-publish.yml'
  },

  // ── js-lint ─────────────────────────────────────────────────────────────
  { namespace: 'js_lint.package_json', policyDir: 'js_lint', rule: 'js-lint', single: 'package.json' },
  {
    namespace: 'js_lint.lint_js_yml',
    policyDir: 'js_lint',
    rule: 'js-lint',
    single: '.github/workflows/lint-js.yml'
  },

  // ── image-compress / image-avif / capacitor ─────────────────────────────
  {
    namespace: 'image_compress.package_json',
    policyDir: 'image_compress',
    rule: 'image-compress',
    single: 'package.json'
  },
  {
    namespace: 'image_avif.package_json',
    policyDir: 'image_avif',
    rule: 'image-avif',
    walk: { match: rel => rel.endsWith('/package.json') || rel === 'package.json' }
  },
  {
    namespace: 'capacitor.package_json',
    policyDir: 'capacitor',
    rule: 'capacitor',
    single: 'package.json'
  },

  // ── hasura ──────────────────────────────────────────────────────────────
  {
    namespace: 'hasura.svc_hl',
    policyDir: 'hasura',
    rule: 'hasura',
    single: 'hasura/k8s/base/svc-hl.yaml'
  },

  // ── adr ─────────────────────────────────────────────────────────────────
  { namespace: 'adr.settings_json', policyDir: 'adr', rule: 'adr', single: '.claude/settings.json' },
  {
    namespace: 'adr.settings_local_json',
    policyDir: 'adr',
    rule: 'adr',
    single: '.claude/settings.local.json'
  },

  // ── multi-file (walk) ───────────────────────────────────────────────────
  // Усі `package.json` у дереві (включно з workspace-пакетами).
  {
    namespace: 'js_mssql.package_json',
    policyDir: 'js_mssql',
    rule: 'js-mssql',
    walk: { match: rel => rel.endsWith('/package.json') || rel === 'package.json' }
  },
  {
    namespace: 'js_bun_db.package_json',
    policyDir: 'js_bun_db',
    rule: 'js-bun-db',
    walk: { match: rel => rel.endsWith('/package.json') || rel === 'package.json' }
  },
  {
    namespace: 'js_bun_redis.package_json',
    policyDir: 'js_bun_redis',
    rule: 'js-bun-redis',
    walk: { match: rel => rel.endsWith('/package.json') || rel === 'package.json' }
  },
  {
    namespace: 'js_run.package_json',
    policyDir: 'js_run',
    rule: 'js-run',
    walk: { match: rel => rel.endsWith('/package.json') || rel === 'package.json' }
  },
  // `js_run.jsconfig` НЕ реєструємо тут — `jsconfig.json` має канонічну структуру
  // лише для backend-пакетів (без `vite` у `devDependencies`) з каталогом `src/`,
  // а lint-conftest фільтрує лише по `activeRules` на рівні репозиторію — не
  // вміє пропустити окремий workspace-пакет за наявністю `vite`. Тому валідація
  // структури делегується з `check-js-run.mjs` через `runConftestBatch` після
  // того, як JS визначить, що пакет — backend з `src/`.
  {
    namespace: 'vue.package_json',
    policyDir: 'vue',
    rule: 'vue',
    walk: { match: rel => rel.endsWith('/package.json') || rel === 'package.json' }
  },

  // ConfigMap у `…/k8s/base/configmap.yaml` будь-де у дереві.
  {
    namespace: 'js_run.configmap',
    policyDir: 'js_run',
    rule: 'js-run',
    walk: { match: rel => K8S_CONFIGMAP_PATH_RE.test(rel) }
  },

  // Усі YAML у дереві з сегментом `k8s` — пер-документні структурні правила.
  {
    namespace: 'k8s.manifest',
    policyDir: 'k8s/manifest',
    rule: 'k8s',
    walk: { match: rel => K8S_DIR_PATH_RE.test(rel) && (rel.endsWith('.yaml') || rel.endsWith('.yml')) }
  },

  // Gateway API + HealthCheckPolicy — застосовується до будь-якого YAML під k8s
  // (правила перевіряють лише відповідні kind / apiVersion).
  {
    namespace: 'k8s.gateway',
    policyDir: 'k8s/gateway',
    rule: 'k8s',
    walk: { match: rel => K8S_DIR_PATH_RE.test(rel) && (rel.endsWith('.yaml') || rel.endsWith('.yml')) }
  },

  // Структурні перевірки HPA / PDB (apiVersion / behavior / metrics / selector).
  {
    namespace: 'k8s.hpa_pdb',
    policyDir: 'k8s/hpa_pdb',
    rule: 'k8s',
    walk: { match: rel => K8S_DIR_PATH_RE.test(rel) && (rel.endsWith('.yaml') || rel.endsWith('.yml')) }
  },

  // Kustomization-файли: resources sort, patches sort, JSON6902 conflicts.
  {
    namespace: 'k8s.kustomization',
    policyDir: 'k8s/kustomization',
    rule: 'k8s',
    walk: { match: rel => K8S_KUSTOMIZATION_PATH_RE.test(rel) }
  },

  // svc.yaml — cluster-IP Service.
  {
    namespace: 'k8s.svc_yaml',
    policyDir: 'k8s/svc_yaml',
    rule: 'k8s',
    walk: { match: rel => K8S_SVC_YAML_PATH_RE.test(rel) }
  },

  // svc-hl.yaml — headless Service з суфіксом `-hl`.
  {
    namespace: 'k8s.svc_hl_yaml',
    policyDir: 'k8s/svc_hl_yaml',
    rule: 'k8s',
    walk: { match: rel => K8S_SVC_HL_YAML_PATH_RE.test(rel) }
  },

  // base/kustomization.yaml — обов'язкове непорожнє поле `namespace:`.
  {
    namespace: 'k8s.base_kustomization',
    policyDir: 'k8s/base_kustomization',
    rule: 'k8s',
    walk: { match: rel => K8S_BASE_KUSTOMIZATION_PATH_RE.test(rel) }
  },

  // Ресурсні маніфести під `…/k8s/.../base/...` (окрім kustomization.yaml).
  {
    namespace: 'k8s.base_manifest',
    policyDir: 'k8s/base_manifest',
    rule: 'k8s',
    walk: {
      match: rel =>
        K8S_BASE_MANIFEST_PATH_RE.test(rel) &&
        !K8S_BASE_KUSTOMIZATION_PATH_RE.test(rel) &&
        (rel.endsWith('.yaml') || rel.endsWith('.yml'))
    }
  },

  // abie HealthCheckPolicy: `hc.yaml` у дереві k8s.
  {
    namespace: 'abie.health_check_policy',
    policyDir: 'abie/health_check_policy',
    rule: 'abie',
    walk: { match: rel => K8S_HC_YAML_PATH_RE.test(rel) }
  },

  // abie HTTPRoute у `base/`.
  {
    namespace: 'abie.http_route_base',
    policyDir: 'abie/http_route_base',
    rule: 'abie',
    walk: { match: rel => K8S_BASE_HR_YAML_PATH_RE.test(rel) }
  },

  // abie Deployment у `…/k8s/.../base/...` має preem nodeSelector.
  {
    namespace: 'abie.base_deployment_preem',
    policyDir: 'abie/base_deployment_preem',
    rule: 'abie',
    walk: {
      match: rel =>
        K8S_BASE_RESOURCE_PATH_RE.test(rel) &&
        !K8S_BASE_KUSTOMIZATION_PATH_RE.test(rel) &&
        (rel.endsWith('.yaml') || rel.endsWith('.yml'))
    }
  },

  // abie clean-merged-branch.yml: with.ignore_branches має містити dev/ua/ru.
  {
    namespace: 'abie.clean_merged_ignore_branches',
    policyDir: 'abie/clean_merged_ignore_branches',
    rule: 'abie',
    single: '.github/workflows/clean-merged-branch.yml'
  }
]

/**
 * Рекурсивно збирає відносні (posix) шляхи від cwd, які матчаться предикатом.
 * Глибокі ігнори — `SKIP_DIR_NAMES`. Не йде у симлінки, помилки stat — мовчки skip.
 * @param {string} root абсолютний корінь обходу
 * @param {(relPosix: string) => boolean} match предикат на відносний posix-шлях
 * @returns {string[]} список відносних posix-шляхів
 */
function collectFiles(root, match) {
  /** @type {string[]} */
  const out = []
  /** @param {string} dirAbs абсолютний шлях каталогу для рекурсивного обходу */
  function visit(dirAbs) {
    /** @type {import('node:fs').Dirent[]} */
    let entries
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const abs = join(dirAbs, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(e.name)) continue
        visit(abs)
        continue
      }
      if (!e.isFile()) continue
      const rel = abs
        .slice(root.length + 1)
        .split(sep)
        .join('/')
      if (match(rel)) out.push(rel)
    }
  }
  visit(root)
  return out
}

/**
 * Розвʼязує файлові цілі для одного таргета щодо cwd.
 * @param {ConftestTarget} target опис таргета
 * @param {string} cwd корінь репозиторію
 * @returns {string[]} список абсолютних / відносних шляхів
 */
function resolveTargetFiles(target, cwd) {
  if (target.single) {
    return existsSync(join(cwd, target.single)) ? [target.single] : []
  }
  if (target.walk) {
    return collectFiles(cwd, target.walk.match)
  }
  return []
}

/**
 * Запускає conftest на одному таргеті. Повертає exit-код (0 — OK, 1+ — помилки).
 *
 * При відсутніх цільових файлах — мовчки повертає 0 (правило неактуальне для repo).
 * Логує заголовок з namespace і кількістю файлів, як `lint-ga.mjs`.
 * @param {string} conftestBin абсолютний шлях до бінарника conftest
 * @param {ConftestTarget} target опис таргета
 * @param {string[]} files список файлів для перевірки (відносні до cwd)
 * @returns {number} exit-код
 */
function runConftestForTarget(conftestBin, target, files) {
  const policyAbs = join(POLICY_DIR, target.policyDir)
  if (!existsSync(policyAbs)) {
    return 0
  }
  console.log(`\n▶ conftest (${target.namespace} — ${files.length} файл(ів))`)
  const r = spawnSync(conftestBin, ['test', ...files, '-p', policyAbs, '--namespace', target.namespace, '--no-color'], {
    stdio: 'inherit',
    env: process.env
  })
  if (r.error) {
    console.error(`❌ Не вдалося запустити conftest: ${r.error.message}`)
    return 1
  }
  return r.status ?? 1
}

/**
 * Запускає `conftest test` по всіх таргетах із `TARGETS`. Перший ненульовий exit-код
 * запамʼятовується, але цикл йде до кінця, щоб користувач побачив усі порушення.
 *
 * Якщо `conftest` не знайдено в PATH — друкує `ℹ` повідомлення і повертає 0
 * (структурні перевірки в `check-*.mjs` лишаються паралельно).
 * @returns {number} 0 — все OK або skip; інакше — перший ненульовий exit-код
 */
export function runLintConftestCli() {
  const conftestBin = resolveCmd('conftest')
  if (!conftestBin) {
    console.log(
      'ℹ conftest не знайдено в PATH — пропускаю Rego-перевірки.\n' +
        '  Встанови, щоб запустити локально: brew install conftest (macOS) або https://www.conftest.dev/install/'
    )
    return 0
  }
  if (!existsSync(POLICY_DIR)) {
    console.log(`ℹ Каталог Rego-полісі не знайдено (${POLICY_DIR}) — пропускаю conftest.`)
    return 0
  }

  const cwd = process.cwd()
  const activeRules = loadActiveCursorRules(cwd)
  let firstFailureCode = 0
  for (const target of TARGETS) {
    if (target.rule && activeRules && !activeRules.has(target.rule)) continue
    const files = resolveTargetFiles(target, cwd)
    if (files.length === 0) continue
    const code = runConftestForTarget(conftestBin, target, files)
    if (code !== 0 && firstFailureCode === 0) {
      firstFailureCode = code
    }
  }
  return firstFailureCode
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runLintConftestCli()
}
