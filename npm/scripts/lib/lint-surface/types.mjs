/**
 * Контракти unified lint surface (spec: docs/specs/2026-06-29-unified-lint-surface.md).
 *
 * Один detector API, один result type, дві чесні ролі:
 *   - `lint(ctx) -> LintResult` тільки виявляє порушення (read-only, без LLM, без side effects);
 *   - central fix pipeline (T0 + tier ladder) виправляє і перевіряє результат.
 *
 * Цей модуль не містить runtime-логіки — лише JSDoc typedefs, спільні для runner-а,
 * detector-ів, T0-патернів і fix-worker-ів. Імпортуй через `@typedef {import(...)}`.
 */

/**
 * Вхід detector-а. Runner будує `ctx` per concern.
 * @typedef {object} LintContext
 * @property {string} cwd абсолютний корінь consumer-репо
 * @property {string} ruleId id правила (`rules/<rule>`)
 * @property {string} concernId id concern-а (`rules/<rule>/<concern>`)
 * @property {string} [concernDir] абсолютний шлях до каталогу concern-а (для T0, що читають
 *   власний `template/`); runner заповнює, detector зазвичай не потребує
 * @property {string[]} [files] posix-relative файли від `cwd` для per-file запуску;
 *   `undefined` означає whole-repo
 */

/**
 * Одне порушення. Namespace стабільного коду — `(ruleId, concernId, reason)`,
 * тому різні concerns можуть мати однакові `reason` (`missing`, `crc-mismatch`, ...).
 * @typedef {object} LintViolation
 * @property {string} ruleId заповнюється detector-ом із ctx або normalizer-ом runner-а
 * @property {string} concernId
 * @property {string} reason стабільний machine code (`crc-mismatch`, `no-unused-vars`)
 * @property {string} message людиночитний опис (єдине джерело для runner-render)
 * @property {string} [file] posix-relative шлях від cwd; absolute і `..` заборонені
 * @property {'error'|'warn'} [severity] default `error`
 * @property {Record<string, unknown>} [data] concern-specific payload для T0/worker;
 *   runner не розгалужується за його формою
 */

/**
 * Технічна діагностика (не основний violation-report). Runner показує у verbose/debug.
 * @typedef {object} LintDiagnostic
 * @property {'info'|'warn'} level
 * @property {string} message
 */

/**
 * Результат detector-а. Не містить exit code — exit це похідна CLI-семантика
 * (0 = немає violations, 1 = є, 2 = exception/invalid result/tool crash).
 * @typedef {object} LintResult
 * @property {LintViolation[]} violations
 * @property {LintDiagnostic[]} [diagnostics]
 */

/**
 * Detector-контракт concern-а (`main.mjs`).
 * @callback LintFn
 * @param {LintContext} ctx
 * @returns {Promise<LintResult> | LintResult}
 */

/**
 * Детермінований T0-патерн (`fix-<concern>.mjs` експортує `patterns: T0Pattern[]`).
 * Отримує ТІЛЬКИ violations свого concern-а (runner scope-ить за ruleId/concernId).
 * @typedef {object} T0Pattern
 * @property {string} id унікальний id патерну (дедуп за ним при re-export)
 * @property {(violations: LintViolation[]) => boolean} test чи застосовний патерн
 * @property {(violations: LintViolation[], ctx: LintContext) => Promise<T0Result> | T0Result} apply
 */

/**
 * @typedef {object} T0Result
 * @property {string[]} touchedFiles абсолютні шляхи змінених файлів
 * @property {string} [message] опис дії для debug/telemetry
 */

/**
 * Контекст одного rung-а fix-worker-а. Описує single attempt, НЕ всю ladder.
 * Worker знає поточний tier/model і feedback попереднього rung-а, але не вирішує,
 * який tier буде наступним, не володіє rollback і не визначає success.
 * @typedef {object} FixContext
 * @property {string} cwd
 * @property {string} ruleId
 * @property {string} concernId
 * @property {string[]} [files]
 * @property {'local-min'|'local-min-retry'|'cloud-min'|'cloud-avg'} tier
 * @property {string} [model] "provider/model-id"
 * @property {AbortSignal} [signal]
 * @property {object} [feedback] structured diagnosis попереднього rung-а
 * @property {(absPath: string) => void} recordWrite worker ЗОБОВ'ЯЗАНИЙ викликати
 *   перед будь-яким записом у файл — runner так знімає pre-image для central rollback.
 *   Це обов'язок реєстрації, НЕ володіння rollback-ом (rollback лишається в runner).
 */

/**
 * Контракт fix-worker-а (`fix-worker.mjs` експортує `fixWorker`).
 * Повертає лише застосовані зміни — success визначає canonical re-check runner-а.
 * @callback FixWorkerFn
 * @param {LintViolation[]} violations violations свого concern-а
 * @param {FixContext} ctx
 * @returns {Promise<FixWorkerResult>}
 */

/**
 * @typedef {object} FixWorkerResult
 * @property {string[]} touchedFiles абсолютні шляхи змінених файлів
 * @property {object} [telemetry] опційні метрики rung-а
 */

/**
 * Поверхня policy-concern-а у concern.json (target-семантика для generated detector-а).
 * @typedef {object} PolicySurface
 * @property {'rego'|'template'} engine
 * @property {{ single?: string, walkGlob?: string|string[], required?: boolean }} files
 * @property {string} [missingMessage] override fail-повідомлення для required:single
 */

/**
 * Lint-поверхня concern-а (коли concern запускається).
 * @typedef {object} LintSurface
 * @property {'per-file'|'full'} scope
 * @property {string[]} glob нормалізований масив; порожній якщо не задано
 */

export {}
