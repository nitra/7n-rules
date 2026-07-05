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
 * @property {boolean} [verbose] `--verbose` CLI-прапорець; concern-и із зовнішніми
 *   інструментами (напр. `ga/workflows`) звіряються з ним, щоб не засмічувати прогрес-бар `lint --full`
 */

/**
 * Одне порушення. Namespace стабільного коду — `(ruleId, concernId, reason)`,
 * тому різні concerns можуть мати однакові `reason` (`missing`, `crc-mismatch`, ...).
 * @typedef {object} LintViolation
 * @property {string} ruleId заповнюється detector-ом із ctx або normalizer-ом runner-а
 * @property {string} concernId id concern-а, до якого належить порушення
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
 * @property {'info'|'warn'} level рівень діагностики
 * @property {string} message текст діагностики
 */

/**
 * Результат detector-а. Не містить exit code — exit це похідна CLI-семантика
 * (0 = немає violations, 1 = є, 2 = exception/invalid result/tool crash).
 * @typedef {object} LintResult
 * @property {LintViolation[]} violations перелік виявлених порушень
 * @property {LintDiagnostic[]} [diagnostics] технічні діагностики для verbose/debug
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
 * @property {(violations: LintViolation[], ctx: LintContext) => Promise<T0Result> | T0Result} apply застосовує детерміноване виправлення й повертає результат
 * @property {boolean} [standalone] true — патерн сам ідемпотентний і самоаналізуючий (напр.
 *   `oxfmt --write`, `ruff --fix`): не потребує per-violation даних, щоб вирішити, чи
 *   запускати `apply()` — runner обходить `test()` і, якщо ВСІ патерни concern-а standalone,
 *   пропускає початковий detect у fix-режимі (spec
 *   docs/specs/2026-07-02-text-check-per-file-split-design.md §8, Phase 2). Не стосується
 *   `--no-fix` (detect-only) шляху.
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
 * @property {string} cwd абсолютний корінь consumer-репо
 * @property {string} ruleId id правила поточного concern-а
 * @property {string} concernId id concern-а, який виправляється
 * @property {string[]} [files] posix-relative файли для per-file виправлення; `undefined` — whole-repo
 * @property {'local-min'|'local-min-retry'|'cloud-min'|'cloud-avg'} tier поточний rung ladder-а
 * @property {string} [model] "provider/model-id"
 * @property {number} [timeoutMs] per-tier таймаут rung-а (ADR 260620-0556) — worker
 *   ЗОБОВ'ЯЗАНИЙ прокинути його у свій LLM-виклик (напр. `runAgentFix`/`runOneShot`
 *   opts.timeoutMs), щоб зависла сесія переривалась зсередини (abort); runner додатково тримає
 *   backstop ×1.25 навколо всього worker-виклику
 * @property {AbortSignal} [signal] сигнал скасування rung-а
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
 * @property {'rego'|'template'} engine рушій перевірки policy-concern-а
 * @property {{ single?: string, walkGlob?: string|string[], required?: boolean }} files цільові файли concern-а (одиничний, glob-обхід, обовʼязковість)
 * @property {string} [missingMessage] override fail-повідомлення для required:single
 */

/**
 * Lint-поверхня concern-а (коли concern запускається).
 * @typedef {object} LintSurface
 * @property {'per-file'|'full'} scope режим запуску concern-а (пофайлово чи по всьому дереву)
 * @property {string[]} glob нормалізований масив; порожній якщо не задано
 */

export {}
