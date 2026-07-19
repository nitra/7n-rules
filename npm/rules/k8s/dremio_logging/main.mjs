/** @see ./dremio_logging.mdc */

/**
 * JS-доповнення до `k8s.dremio_logging` (rego) для `dremio_v2/templates/zookeeper.yaml` —
 * vendored Helm-темплейт ZooKeeper (Go-template синтаксис, `{{ ... }}`), тому НЕ валідний
 * YAML/XML і conftest його розпарсити не може (звідси JS, не rego, для цього файлу).
 *
 * Перевіряє: якщо файл визначає `ConfigMap` з ключем `data["logback.xml"]` (bundled-конфіг
 * образу `zookeeper:3.8.4-jre-17`, змонтований поверх `/conf/logback.xml`), його
 * `<root level="...">` має бути `warn`/`error`/`off` — не `info` (дефолт бандлованого файлу).
 *
 * Чому: readiness/liveness-проби (`ruok`) виконуються кожні ~10s на кожен zk-под;
 * `NIOServerCnxn` логує це на INFO незалежно від навантаження. Спроби керувати рівнем ззовні
 * (`ZOO_LOG4J_PROP` — Bitnami-змінна, тут не читається; `-Dzookeeper.console.threshold`
 * через JVMFLAGS — перебивається `<property name="zookeeper.console.threshold" value="INFO"/>`
 * у бандлованому файлі) не працюють для цього образу — єдиний робочий шлях: змонтувати
 * власний `logback.xml` з іншим `root level`.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

const ROOT_LEVEL_RE = /<root\s+level\s*=\s*["']([^"']+)["']/iu
const LOGBACK_XML_KEY_RE = /logback\.xml:\s*\|/u
const ALLOWED_ROOT_LEVELS = new Set(['warn', 'error', 'off'])

/**
 * Чи файл (Helm-темплейт ZooKeeper) визначає вбудований `logback.xml` з надто гучним
 * `<root level="...">` (info/debug/trace, чи взагалі відсутній тег root).
 * @param {string} content вміст `dremio_v2/templates/zookeeper.yaml`
 * @returns {string | null} текст порушення, або null — якщо `logback.xml`-блоку немає
 *   (нема чого перевіряти) чи `root level` вже warn/error/off
 */
export function zkLogbackRootLevelViolation(content) {
  if (!LOGBACK_XML_KEY_RE.test(content)) return null // немає вбудованого logback.xml — не наша справа
  const m = ROOT_LEVEL_RE.exec(content)
  if (m === null) {
    return 'zookeeper.yaml: вбудований logback.xml без <root level="..."> — додай ConfigMap-оверрайд з level="warn" (k8s.mdc)'
  }
  const level = m[1].toLowerCase()
  if (ALLOWED_ROOT_LEVELS.has(level)) return null
  return `zookeeper.yaml: вбудований logback.xml має <root level="${m[1]}"> — постав "warn" або строгіше (error/off), бо ruok-проби кожні ~10s заливають Cloud Logging на INFO (k8s.mdc)`
}

/**
 * Detector `k8s.dremio_logging` для ZooKeeper-темплейту (per-file, read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter

  for (const rel of ctx.files ?? []) {
    let content
    try {
      content = await readFile(join(ctx.cwd, rel), 'utf8')
    } catch {
      continue
    }
    const violation = zkLogbackRootLevelViolation(content)
    if (violation !== null) fail(`${rel}: ${violation}`, 'zk-logback-root-level')
  }

  return reporter.result()
}
