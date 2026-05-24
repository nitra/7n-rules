/**
 * Запускає `conftest test` на batched-списку файлів і повертає всі порушення
 * у структурованому вигляді. Використовується з `check-*.mjs`-скриптів, де
 * пер-документні правила винесені у `npm/policy/<rule>/<name>/` як rego-полісі
 * (Rego-authoritative). JS у `check-*.mjs` робить cross-file частину (walking
 * дерева, парність, kustomize-резолюція), а пер-документне валідаційне ядро
 * делегується сюди — один спавн `conftest` на (`namespace`, `policyDir`),
 * незалежно від кількості файлів. Це закриває дублювання JS↔rego і прибирає
 * ризик дрифту (типу `spec.config` vs `spec.default.config` у
 * `health_check_policy.rego`, що ми ловили cross-check тестами).
 *
 * Hard-fail на відсутність `conftest` у PATH — узгоджено з рішенням Plan B:
 * якщо правило делегує свою логіку до Rego, а інструмент відсутній, тиха
 * відмова приховує реальні порушення. Друкуємо install-hint (як `lint-rego.mjs`
 * робить для opa/regal).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveCmd } from '../utils/resolve-cmd.mjs'

/**
  Каталог пакета `@nitra/cursor`, від якого ресолвимо вшиті директорії правил.
 */
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/** Шлях до кореня правил. У npm-tarball публікується через `files: ["rules"]`. Кожне правило: `rules/<id>/policy/<name>/`. */
const RULES_ROOT = join(PACKAGE_ROOT, 'rules')

/**
 * Друкує install-hint для conftest і кидає виняток, щоб викликана `check-*`
 * команда ясно завершилась з кодом 1.
 * @returns {never} завжди кидає; для точки виклику — non-returning
 */
function failConftestMissing() {
  throw new Error(
    [
      '❌ conftest не знайдено в PATH.',
      '   Без нього не запускається пер-документна валідація через rego-полісі (npm/policy/).',
      '   Встанови:',
      '     macOS:     brew install conftest',
      '     Universal: https://www.conftest.dev/install/'
    ].join('\n')
  )
}

/**
 * @typedef {object} ConftestViolation
 * @property {string} filename абсолютний шлях до файла, що дав порушення (з output conftest)
 * @property {string} message текст порушення (як у `deny` rego-пакета)
 * @property {string} namespace namespace rego-пакета (наприклад `abie.base_deployment_preem`)
 */

/**
 * @typedef {object} ConftestBatchOptions
 * @property {string} policyDirRel шлях до підкаталогу `npm/policy/...` (наприклад `abie/base_deployment_preem`)
 * @property {string} namespace повне імʼя rego-пакета (наприклад `abie.base_deployment_preem`)
 * @property {string[]} files список абсолютних шляхів файлів для перевірки (порожній — повертаємо порожньо)
 * @property {string[]} [extraArgs] додаткові аргументи для conftest (наприклад `--combine` для крос-документних правил)
 * @property {object} [templateData] опціональне merged-дерево; серіалізується у JSON `{ "template": <data> }` і передається як `--data <tmpfile>` (cleanup після завершення)
 */

/**
 * Pure args builder for conftest test. Extracted for unit-testability.
 * Preserves the existing args layout (files before -p; --output json --no-color
 * for parseable output); inserts --data right after --namespace when provided.
 * @param {{ policyAbs: string, namespace: string, files: string[], extraArgs: string[], tmpDataFile: string|null }} p параметри батчу
 * @returns {string[]} args для виклику conftest
 */
export function buildConftestArgs(p) {
  const args = ['test', ...p.files, '-p', p.policyAbs, '--namespace', p.namespace]
  if (p.tmpDataFile) args.push('--data', p.tmpDataFile)
  args.push('--output', 'json', '--no-color', ...p.extraArgs)
  return args
}

/**
 * Виконує `conftest test` для всіх файлів одним спавном і повертає масив
 * порушень. Якщо `files` порожній — повертає `[]` без спавна. Якщо `conftest`
 * не у PATH — кидає виняток (hard fail, див. модульний docstring).
 * @param {ConftestBatchOptions} opts параметри запуску
 * @returns {ConftestViolation[]} масив порушень (порожній — все ок)
 */
export function runConftestBatch(opts) {
  if (opts.files.length === 0) return []
  const conftestBin = resolveCmd('conftest')
  if (!conftestBin) {
    failConftestMissing()
  }
  // policyDirRel — формат `<rule>/<name>` (наприклад `abie/base_deployment_preem`).
  // Реальний шлях у новій структурі: `rules/<rule>/policy/<name>`.
  const slash = opts.policyDirRel.indexOf('/')
  const ruleId = slash === -1 ? opts.policyDirRel : opts.policyDirRel.slice(0, slash)
  const sub = slash === -1 ? '' : opts.policyDirRel.slice(slash + 1)
  const policyAbs = sub ? join(RULES_ROOT, ruleId, 'policy', sub) : join(RULES_ROOT, ruleId, 'policy')
  if (!existsSync(policyAbs)) {
    throw new Error(`runConftestBatch: rego-каталог не знайдено: ${policyAbs}`)
  }
  let tmpDataDir = null
  let tmpDataFile = null
  if (opts.templateData) {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'n-cursor-tpl-'))
    tmpDataFile = join(tmpDataDir, 'template-data.json')
    writeFileSync(tmpDataFile, JSON.stringify({ template: opts.templateData }))
  }
  try {
    const args = buildConftestArgs({
      policyAbs,
      namespace: opts.namespace,
      files: opts.files,
      extraArgs: opts.extraArgs ?? [],
      tmpDataFile
    })
    const result = spawnSync(conftestBin, args, { encoding: 'utf8' })
    if (result.error) throw result.error
    // conftest exit 1 = є failures (це валідно для нас); >1 = справжня помилка.
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`conftest exit ${result.status}: ${(result.stderr || result.stdout || '').slice(0, 500)}`)
    }
    /**
  @type {Array<{ filename: string, namespace: string, failures?: Array<{ msg: string }> }>}
     */
    let parsed
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      throw new Error(`conftest stdout не парситься як JSON: ${(result.stdout || '').slice(0, 200)}`)
    }
    /**
  @type {ConftestViolation[]}
     */
    const out = []
    for (const entry of parsed) {
      const failures = entry.failures ?? []
      for (const f of failures) {
        out.push({ filename: entry.filename, namespace: entry.namespace, message: f.msg })
      }
    }
    return out
  } finally {
    if (tmpDataDir) rmSync(tmpDataDir, { recursive: true, force: true })
  }
}
