/**
 * Запускає `conftest test` на batched-списку файлів і повертає всі порушення
 * у структурованому вигляді. Використовується з `check-*.mjs`-скриптів, де
 * пер-документні правила винесені у `npm/policy/<rule>/<name>/` як rego-полісі
 * (Rego-authoritative). JS у `check-*.mjs` робить cross-file частину (walking
 * дерева, парність, kustomize-резолюція), а пер-документне валідаційне ядро
 * делегується сюді — один спавн `conftest` на (`namespace`, `policyDir`),
 * незалежно від кількості файлів. Це закриває дублювання JS↔rego і прибирає
 * ризик дрифту (типу `spec.config` vs `spec.default.config` у
 * `health_check_policy.rego`, що ми ловили cross-check тестами).
 *
 * Hard-fail на відсутність `conftest` — через `ensureToolAsync`, що спочатку
 * намагається авто-встановити, і лише після невдачі кидає виняток.
 *
 * Async (`spawnAsync`, не `spawnSync`) — детектор не блокує event loop, тож може
 * виконуватись у parallel lane `detectAll()` (ADR 260716-1354). Приймає опційний
 * `signal`/`timeoutMs` — прокидаються в `spawnAsync`.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureToolAsync } from './ensure-tool.mjs'
import { spawnAsync } from '../utils/spawn-async.mjs'

/**
  Каталог пакета `@7n/rules`, від якого ресолвимо вшиті директорії правил.
 */
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/** Шлях до кореня правил. У npm-tarball публікується через `files: ["rules"]`. Кожне правило: `rules/<id>/policy/<name>/`. */
const RULES_ROOT = join(PACKAGE_ROOT, 'rules')

/**
 * @typedef {object} ConftestViolation
 * @property {string} filename абсолютний шлях до файла, що дав порушення (з output conftest)
 * @property {string} message текст порушення (як у `deny` rego-пакета)
 * @property {string} namespace namespace rego-пакета (наприклад `abie.base_deployment_preem`)
 */

/**
 * @typedef {object} ConftestBatchOptions
 * @property {string} policyDirRel шлях до підкаталогу `npm/policy/...` (наприклад `abie/base_deployment_preem`)
 * @property {string} [policyDirAbs] абсолютний шлях до теки policy-concern-а — для правил ПОЗА вбудованим
 *   `rules/` ядра (плагіни); за наявності має пріоритет над `policyDirRel`
 * @property {string} namespace повне імʼя rego-пакета (наприклад `abie.base_deployment_preem`)
 * @property {string[]} files список абсолютних шляхів файлів для перевірки (порожній — повертаємо порожньо)
 * @property {string[]} [extraArgs] додаткові аргументи для conftest (наприклад `--combine` для крос-документних правил)
 * @property {object} [templateData] опціональне merged-дерево; серіалізується у JSON `{ "template": <data> }` і передається як `--data <tmpfile>` (cleanup після завершення)
 * @property {AbortSignal} [signal] сигнал скасування — прокидається у `spawnAsync`
 * @property {number} [timeoutMs] ліміт виконання `conftest` у мілісекундах — прокидається у `spawnAsync`
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
 * не у PATH і авто-встановлення не вдалось — кидає виняток (hard fail).
 * @param {ConftestBatchOptions} opts параметри запуску
 * @returns {Promise<ConftestViolation[]>} масив порушень (порожній — все ок)
 */
export async function runConftestBatch(opts) {
  if (opts.files.length === 0) return []
  const conftestBin = await ensureToolAsync('conftest')
  // policyDirRel — формат `<rule>/<concern>` (наприклад `abie/base_deployment_preem`).
  // Flat concern path: rules/<rule>/<concern>/ (без проміжного `policy/`).
  const slash = opts.policyDirRel.indexOf('/')
  const ruleId = slash === -1 ? opts.policyDirRel : opts.policyDirRel.slice(0, slash)
  const sub = slash === -1 ? '' : opts.policyDirRel.slice(slash + 1)
  const policyAbs = opts.policyDirAbs ?? (sub ? join(RULES_ROOT, ruleId, sub) : join(RULES_ROOT, ruleId))
  if (!existsSync(policyAbs)) {
    throw new Error(`runConftestBatch: rego-каталог не знайдено: ${policyAbs}`)
  }
  let tmpDataDir = null
  let tmpDataFile = null
  if (opts.templateData) {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'n-rules-tpl-'))
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
    const result = await spawnAsync(conftestBin, args, { signal: opts.signal, timeoutMs: opts.timeoutMs })
    // conftest exit 1 = є failures (це валідно для нас); >1 (або null — вбито сигналом/таймаутом) = справжня помилка.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`conftest exit ${result.exitCode}: ${(result.stderr || result.stdout || '').slice(0, 500)}`)
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
