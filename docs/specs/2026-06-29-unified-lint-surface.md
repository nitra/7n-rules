# Spec: unified lint surface — одна команда, один discovery, один result type

**Дата:** 2026-06-29
**Статус:** Draft
**Тип:** Breaking — міграція всіх concerns одним кроком, без backwards-compat

**Пов'язані документи:**

- `docs/specs/2026-06-28-concern-lint-scope-design.md` — concern-directory layout
- `docs/specs/2026-06-26-pi-fix-engine-migration.md` — pi як fix-engine

---

## Мета

Фінальний стан має бути простим:

- **одна команда** — `n-cursor lint`;
- **один discovery** — `rules/<rule>/<concern>/concern.json`;
- **один result type** — `LintResult`;
- **дві чесні ролі**:
  - `lint()` тільки виявляє порушення;
  - central fix pipeline виправляє порушення і перевіряє результат.

`n-cursor fix` видаляється повністю. Без alias, без deprecation-window, без прихованої переадресації.

---

## Проблема

Поточна модель має три окремі поверхні:

| Surface | Контракт | Виклик | Fix |
| --- | --- | --- | --- |
| `lint` | `lint(files, cwd, opts) -> number` | `n-cursor lint` | іноді всередині detector-а |
| `check` | `main(cwd) -> number` | conformance orchestrator | T0 + LLM tiers |
| `policy` | Rego + target metadata | conformance orchestrator | template scaffold / ручний fix |

Це створює кілька джерел складності:

- detector-и можуть мутувати дерево, тому `lint` і `fix` змішані;
- `check` і `policy` живуть в окремій conformance-фазі після `lint`;
- runner бачить тільки exit code або stdout і не має структурованого списку порушень;
- `llmFix` як прапор дублює реальний факт наявності fix-можливості;
- Rego policy потребують окремого discovery і окремої target-інфраструктури.

---

## Рішення

Усі concerns стають detector-ами з одним API:

```js
export async function lint(ctx) {
  return { violations: [] }
}
```

`lint()` завжди:

- read-only;
- без LLM;
- без autofix;
- без `--fix` у downstream tools;
- без side effects у робочому дереві.

Fix-и не є частиною detector-а. Вони є окремою роллю, яку викликає центральний runner після detection.

---

## Result Type

### `LintContext`

```js
/**
 * @typedef {{
 *   cwd: string,
 *   ruleId: string,
 *   concernId: string,
 *   files?: string[]
 * }} LintContext
 */
```

- `cwd` — абсолютний корінь consumer-репо.
- `ruleId` — id правила з `rules/<rule>`.
- `concernId` — id concern-а з `rules/<rule>/<concern>`.
- `files` — posix-relative файли від `cwd` для per-file запуску; `undefined` означає whole-repo.

### `LintViolation`

```js
/**
 * @typedef {{
 *   ruleId: string,
 *   concernId: string,
 *   reason: string,
 *   message: string,
 *   file?: string,
 *   severity?: 'error' | 'warn',
 *   data?: Record<string, unknown>
 * }} LintViolation
 */
```

Обов'язкові поля:

- `ruleId` і `concernId` — заповнюються detector-ом із `ctx` або helper-ом runner-а;
- `reason` — стабільний machine code (`crc-mismatch`, `no-unused-vars`, `network-policy-missing`);
- `message` — людиночитний опис порушення.

`reason` не є глобально унікальним. Його namespace — `(ruleId, concernId, reason)`, тому різні concerns можуть мати однакові `reason` на кшталт `missing`, `invalid-config`, `crc-mismatch`.

Опційні поля:

- `file` — posix-relative шлях від `cwd`; absolute paths і `..` заборонені;
- `severity` — default `error`;
- `data` — concern-specific payload для T0/worker. Runner не розгалужується за його формою.

### `LintResult`

```js
/**
 * @typedef {{
 *   violations: LintViolation[],
 *   diagnostics?: Array<{ level: 'info' | 'warn', message: string }>
 * }} LintResult
 */
```

`LintResult` не містить exit code. Exit code — похідна CLI-семантика:

- `violations.length === 0` -> exit `0`;
- `violations.length > 0` -> exit `1`;
- exception / invalid result / tool crash -> exit `2`.

У `--no-fix` режимі мапінг застосовується до єдиного detect-прогону. У fix-by-default режимі мапінг застосовується до **фінального canonical detect** після T0 / tier ladder / rollback. Проміжні detector-и керують pipeline, але не є фінальним CLI verdict.

Це прибирає дублювання `code` vs `violations.length`.

---

## Concern Contract

### `concern.json`

Кожен executable concern має `concern.json`. Мінімальна форма для JS detector-а:

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/concern.json",
  "lint": {
    "scope": "per-file",
    "glob": ["**/*.{js,mjs,ts,vue}"]
  }
}
```

Policy concern зберігає target-семантику у `policy.files`, але зовні теж стає detector-ом через generated `main.mjs`:

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/concern.json",
  "lint": {
    "scope": "full",
    "glob": [".github/workflows/**"]
  },
  "policy": {
    "engine": "rego",
    "files": {
      "single": ".github/workflows/lint-ga.yml",
      "required": true
    },
    "missingMessage": "lint-ga.yml не існує — створи згідно ga.mdc"
  }
}
```

Template subset concern:

```json
{
  "$schema": "https://unpkg.com/@nitra/cursor/schemas/concern.json",
  "lint": {
    "scope": "full",
    "glob": ["package.json"]
  },
  "policy": {
    "engine": "template",
    "files": {
      "single": "package.json",
      "required": true
    }
  }
}
```

### `lint.scope`

| Scope | Default `n-cursor lint` | `n-cursor lint --full` | `n-cursor lint <rule>` |
| --- | --- | --- | --- |
| `per-file` | changed files filtered by `lint.glob` | `files: undefined` | `files: undefined` |
| `full` with `glob` | runs whole-repo only if `glob` intersects changed files | always runs | always runs |
| `full` without `glob` | does not run in delta mode | always runs | always runs |

Якщо full detector має бути safety scan на кожну зміну, він явно ставить `glob: ["**/*"]`.

### `main.mjs`

```js
/**
 * @param {import('...').LintContext} ctx
 * @returns {Promise<import('...').LintResult>}
 */
export async function lint(ctx) {
  const violations = []
  return { violations }
}
```

Detector-и не друкують основний violation report у stdout/stderr. Вони повертають `LintResult`, а runner є єдиним renderer-ом. Допускаються тільки diagnostics для технічної інформації, яку runner потім показує у verbose/debug режимі.

---

## Policy Codegen

Policy concern не пише boilerplate `main.mjs` вручну. Build-time codegen читає `concern.json` + `{concern}.rego` / `template/` і генерує detector:

```js
// @generated — do not edit
// source-hash: abc123
import { evaluatePolicyConcern } from '../../../../scripts/lib/policy-lint-adapter.mjs'

export async function lint(ctx) {
  return evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: '.github/workflows/lint-ga.yml', required: true },
    missingMessage: 'lint-ga.yml не існує — створи згідно ga.mdc'
  })
}
```

Codegen overwrite-ить тільки файли з `@generated` header. Якщо `main.mjs` існує без `@generated`, це ручний detector і generator його не чіпає.

Generated `main.mjs` комітиться в git. `source-hash` — це hash від `concern.json`, `{concern}.rego`, `template/` і версії codegen template. `run-lint` має pre-detect generated-drift gate:

1. знайти policy concerns із generated `main.mjs`;
2. перерахувати `source-hash`;
3. якщо `main.mjs` відсутній або hash не збігається — у fix-by-default режимі регенерувати;
4. у `--no-fix` режимі не писати файл, а повернути `LintViolation` з `reason: 'policy-codegen-stale'`.

Це той самий принцип, що doc-files CRC gate: stale generated wrapper не має тихо розходитись із policy source.

Policy target semantics не губляться:

- `policy.files.single` / `walkGlob` визначають OPA/template inputs;
- `lint.scope` / `lint.glob` визначають коли concern запускається;
- generated adapter нормалізує Rego/template deny у `LintViolation[]`.

### Policy Unit Tests

`<concern>_test.rego` — це source-validation для policy concern-а, а не окремий consumer detector.

Дім для цих тестів — internal policy source test-step у `run-lint`:

1. Runner використовує той самий concern discovery.
2. Для кожного concern-а з `policy.engine: "rego"` і файлом `<concern>_test.rego` запускається `conftest verify` / `opa test` по concern-директорії.
3. Failure нормалізується у `LintViolation`:

```js
{
  ruleId: 'k8s',
  concernId: 'network_policy',
  reason: 'rego-unit-test-failed',
  message: 'network_policy_test.rego: test_deny_missing_policy failed',
  file: 'rules/k8s/network_policy/network_policy_test.rego',
  data: { engine: 'conftest' }
}
```

Policy unit tests запускаються:

- у `n-cursor lint --no-fix --full`;
- у delta-режимі, якщо змінився `concern.json`, `{concern}.rego`, `{concern}_test.rego` або `template/` цього concern-а;
- перед policy codegen/evaluate, щоб stale/broken generated detector не маскував зламану policy.

Це не public CLI і не четверта surface. Це внутрішній test-step над знайденими policy concerns.

---

## Fix Role

Fix не живе в `lint()`. Runner виконує fix pipeline централізовано.

### Discovery

У concern-директорії можуть бути:

```txt
fix-<concern>.mjs   # deterministic T0 patterns
fix-worker.mjs      # concern-specific worker
```

Наявність цих файлів означає, що concern має fix capability. Окремого `llmFix` прапора немає.

### Violation Scoping

Central runner викликає fix-кроки per concern. Перед T0 або worker runner сам scope-ить violations:

```js
const concernViolations = allViolations.filter(
  v => v.ruleId === ctx.ruleId && v.concernId === ctx.concernId
)
```

`fix-<concern>.mjs` і `fix-worker.mjs` отримують тільки `concernViolations`, а не всі violations правила чи всього lint-прогону.

Наслідки:

- T0 `test()` не зобов'язаний перевіряти `ruleId` / `concernId`;
- `reason: 'missing'` безпечний і може повторюватись у різних concerns;
- cross-concern T0 заборонений у базовому контракті;
- якщо колись потрібен cross-concern fix, він має бути окремим explicit escape hatch, а не неявним доступом до чужих violations.

### T0

```js
/** @type {import('...').T0Pattern[]} */
export const patterns = [
  {
    id: 'doc-files-stamp-crc',
    test: violations => violations.some(v => v.reason === 'crc-mismatch'),
    apply: async (violations, ctx) => {
      return { touchedFiles: ['npm/foo/docs/bar.md'], message: 'оновлено CRC' }
    }
  }
]
```

T0:

- deterministic;
- не викликає LLM;
- повертає touched files;
- не вирішує, чи rule вже clean. Після T0 runner завжди запускає canonical detect.

### `fix-worker.mjs`

```js
/**
 * @typedef {{
 *   cwd: string,
 *   ruleId: string,
 *   concernId: string,
 *   files?: string[],
 *   tier: 'local-min' | 'local-min-retry' | 'cloud-min' | 'cloud-avg',
 *   model?: string,
 *   signal?: AbortSignal,
 *   feedback?: object
 * }} FixContext
 */
```

`FixContext` описує один attempt, а не всю ladder. Worker може знати поточний `tier`/`model` і отримати feedback від попереднього rung-а, але не вирішує, який tier буде наступним.

`local-min-retry` — це повтор того самого local-min model після невдалого `local-min`, але з feedback попереднього rung-а у `ctx.feedback`.

```js
/**
 * @param {import('...').LintViolation[]} violations
 * @param {import('...').FixContext} ctx
 * @returns {Promise<{ touchedFiles: string[], telemetry?: object }>}
 */
export async function fixWorker(violations, ctx) {
  return { touchedFiles: [] }
}
```

Worker:

- отримує structured violations;
- може бути domain-specific wrapper над pi або deterministic generator-ом;
- не володіє tier ladder;
- не володіє rollback;
- не отримує `selfCheck`;
- не повертає `ok`;
- не вирішує success.

Success визначає тільки canonical `lint()` re-check після worker-а.

Якщо pi-agent потребує advisory self-check для iterative refinement всередині одного rung-а, це приватний tool central orchestrator-а. Він не входить у `FixContext`, не доступний concern worker-у як контракт і не може бути джерелом success verdict.

### Central Runner Pipeline

```txt
detect
  -> clean: exit 0
  -> --no-fix: render + exit 1
  -> T0(concernViolations)              # deterministic, permanent — поза rollback
  -> snapshot                           # S1: єдиний baseline, вже post-T0
  -> detect
  -> clean: keep + exit 0
  -> for rung in [local-min, local-min-retry, cloud-min, cloud-avg]:
       restore S1                        # відкочує тільки worker; T0 завжди лишається
       worker(concernViolations, { tier: rung, ...ctx })
       detect
       clean: keep + exit 0
       not clean: continue              # наступний rung знову стартує з S1
  -> exhausted: rollback S1 + exit 1    # T0 лишається навіть при повному провалі
```

Central runner володіє:

- tier ladder (`local-min -> local-min-retry -> cloud-min -> cloud-avg`);
- avg-cap;
- timeout / turn-ceiling;
- write-guard;
- post-T0 snapshot (S1);
- rollback;
- telemetry;
- final render.

Rollback ніколи не означає `rm generated files`. Він відновлює pre-image для змінених файлів і видаляє тільки файли, яких не існувало до attempt-а.

### T0 поза rollback

T0 — детермінований і завжди-коректний крок, тому його результат не є «спробою, яку можна відкинути». Snapshot береться **після** T0 (`S1`), і саме `S1` — мета всіх rung-rollback-ів. Наслідки:

- worker-rung ніколи не відкочує T0-фікси; кожен rung стартує з post-T0 стану;
- при повному провалі ladder-а runner відкочується до `S1` (не до pre-T0), тому T0-зміни лишаються в дереві навіть з exit `1`;
- це монотонний прогрес: T0-результат — те саме, що наступний прогін однаково відтворив би (як `prettier`: інші лінти можуть падати, форматування лишається);
- `--no-fix` ніколи не застосовує T0 і не мутує дерево, тому CI-gate не зачеплено — дивергенція тільки у fix-режимі.

### Tier Ladder Semantics

Кожен rung — ізольований attempt:

1. Runner відновлює `S1` (post-T0 baseline) перед стартом rung-а.
2. Worker застосовує зміни для поточного `tier`.
3. Runner запускає canonical detect для того самого concern-а.
4. Якщо detector clean — зміни лишаються, ladder завершується успіхом.
5. Якщо detector не clean, quality degraded або attempt abort/timeout — runner відкочує до `S1` **перед наступним rung-ом**.

Це означає, що `cloud-min` не отримує degraded файли від `local-min`; він стартує з того самого post-T0 стану. Для `doc-files` низький quality score після rung-а має бути видимий canonical detector-у як violation, наприклад `reason: 'doc-quality-degraded'`, щоб runner міг відкотити attempt і перейти до наступного tier.

Inter-tier feedback передається тільки як текстовий/структурований diagnosis у `FixContext` наступного rung-а, але не як змінені файли в робочому дереві.

### Tier Experiment: sampling / consensus

Production ladder за замовчуванням лишається **one candidate per rung**. Sampling/consensus — це експериментальна оптимізація, а не частина worker-контракту і не нова роль.

Початкова гіпотеза:

- `local-min` — не місце для consensus за замовчуванням: локальний inference повільний, а додаткові samples часто множать noise. Корисний baseline і retry з feedback.
- `cloud-min` — найкращий кандидат для cheap dual-sampling: достатньо швидкий, щоб перевірити `conservative` vs `exploratory` без стрибка одразу в дорожчу модель.
- `cloud-avg` — кандидат для hard cases і advisory judge, але не blanket best-of-N для кожного порушення.
- `cloud-max` — **experiment-only** last-resort / judge tier. Він не входить у default ladder і не промотується без даних по cost/rescue rate.

Експериментальні тири:

```js
/**
 * @typedef {'local-min' | 'cloud-min' | 'cloud-avg' | 'cloud-max'} ExperimentTier
 */
```

`cloud-max` не додається у `FixContext#tier` і production ladder до завершення експерименту. Якщо його промотити, треба окремо оновити `FixContext`, tier helpers, avg/max budget і telemetry schema.

Методика для кожного fixture-а / concern-а / tier-а:

1. Відновити `S1` перед кожною candidate-спробою.
2. Запустити baseline: один `conservative` attempt.
3. Запустити experiment: два ізольовані candidates — `conservative` і `exploratory`.
4. Після кожного candidate-а виконати canonical detect; LLM не вирішує success.
5. Якщо один candidate clean — вибрати його.
6. Якщо кілька candidates clean — вибрати менший diff / менше touched files / дешевший wall-time.
7. Якщо жоден candidate не clean — optional judge може повернути тільки feedback для наступного rung-а, але не може override-ити detector.
8. Фінальний verdict завжди робить canonical detect на вибраному candidate patch.

`samplingProfile` належить central runner / pi adapter, не concern worker-у. Якщо provider підтримує `temperature`, профілі можуть мапитись так:

- `conservative`: provider default або low temperature;
- `exploratory`: higher temperature;
- `judge`: no write tools, deterministic / low temperature.

Якщо provider не має стабільного temperature API, experiment все одно валідний: diversity можна отримувати prompt-варіантом, іншим `thinkingLevel` або іншим tier-ом. У trace треба писати фактичні sampling knobs, які реально пішли в provider payload.

Метрики:

- clean rate після canonical detect;
- rescue rate: baseline failed, experiment clean;
- false-clean rate: має бути `0`, бо detector є oracle;
- wall-time p50/p95;
- tokens / cost;
- touched files і diff size;
- rollback count;
- regression count у downstream tests, якщо concern має test command.

Promotion rule:

- dual-sampling можна вмикати для tier-а тільки якщо rescue rate покриває додаткову вартість і не погіршує p95 latency сильніше, ніж перехід на наступний tier;
- `cloud-max` може стати production rung-ом тільки під окремим max-cap і після доказу, що він дешевший за ручне втручання на залишкових hard cases;
- consensus/judge ніколи не стає success oracle — він лише обирає clean candidate або формує feedback.

---

## CLI

Єдина команда:

```txt
n-cursor lint                 # fix-by-default, delta, enabled rules
n-cursor lint --full          # fix-by-default, whole-repo, enabled rules
n-cursor lint <rule>          # fix-by-default, whole-repo для rule
n-cursor lint <rule>/<concern># fix-by-default, whole-repo для одного concern
n-cursor lint --no-fix        # detect-only, delta
n-cursor lint --no-fix --full # detect-only, whole-repo
n-cursor lint --verbose       # concern selection + diagnostics
```

Видалені команди / прапори:

- `n-cursor fix` — видалено повністю, без alias;
- `n-cursor fix-t0` — видалено як public CLI, T0 є внутрішнім кроком `lint`;
- `--read-only` — замінено на `--no-fix`;
- `llmFix` — видалено зі schema і runtime.

Канонічний full CI gate:

```txt
n-cursor lint --no-fix --full
```

Rule-scoped workflows можуть використовувати `n-cursor lint <rule> --no-fix`, але не мають власних bespoke lint-команд.

---

## Structure

```txt
rules/<rule>/
├── main.json
├── main.mdc
├── <concern>/
│   ├── concern.json
│   ├── main.mjs              # export lint(ctx) -> LintResult
│   ├── <concern>.rego        # optional, policy.engine=rego
│   ├── <concern>_test.rego   # optional, runs via policy source test-step
│   ├── template/             # optional, policy.engine=template
│   ├── fix-<concern>.mjs     # optional T0
│   ├── fix-worker.mjs        # optional worker
│   └── tests/
│       └── <concern>.test.mjs
└── utils/                    # helpers, no concern.json
```

Каталоги без `concern.json` не є concerns. Legacy discovery roots `js/`, `policy/`, `fix/`, `lint/` заборонені у фінальному стані.

---

## Migration

| Було | Стає |
| --- | --- |
| `lint(files, cwd, opts) -> number` | `lint(ctx) -> { violations }`, read-only |
| `opts.readOnly` | видалено; detector завжди read-only |
| `main(cwd)` check concern | `main.mjs::lint(ctx)` з `lint.scope: "full"` |
| Rego + `target.json` | `concern.json#policy` + generated `main.mjs::lint(ctx)` |
| template policy | `policy.engine: "template"` + generated detector |
| `llmFix: true` | видалено; fix capability = `fix-*.mjs` / `fix-worker.mjs` |
| conformance runner | видалено; усі concerns запускає `run-lint` |
| `n-cursor fix` | видалено повністю |
| `n-cursor fix-t0` | видалено як public CLI |
| `--read-only` | `--no-fix` |

Migration виконується одним breaking commit-ом:

1. Оновити `concern.json` schema.
2. Переписати `run-lint` як єдиний discovery + runner.
3. Видалити conformance discovery / runner.
4. Переписати check concerns на `lint(ctx)`.
5. Перенести policy target metadata у `concern.json#policy`.
6. Додати policy codegen.
7. Додати policy source test-step для `{concern}_test.rego`.
8. Переписати T0 на structured `LintViolation[]`.
9. Переписати workers на narrow `fixWorker(violations, ctx)` без rollback/tier ownership.
10. Видалити public `fix` / `fix-t0` CLI entries.
11. Оновити rules/docs/skills/CI references на `n-cursor lint --no-fix`.

---

## Exit Criteria

- `n-cursor lint --no-fix --full` не мутує робоче дерево і не імпортує pi.
- Усі detector-и повертають валідний `LintResult`.
- Усі violations мають `ruleId`, `concernId`, `reason`, `message`.
- `n-cursor fix` відсутній у CLI dispatch і документації.
- `run-lint` має snapshot-тести для delta, full, scoped rule, scoped concern, `--no-fix`.
- T0 і worker отримують тільки violations свого `(ruleId, concernId)`.
- Policy codegen має тести для Rego, template, missing required file, custom manual `main.mjs`.
- Policy generated-drift gate падає у `--no-fix` і регенерує stale `@generated main.mjs` у fix-by-default.
- Policy source test-step запускає `<concern>_test.rego` і репортить failures як `LintViolation`.
- Worker success перевіряється тільки через canonical re-check.
- Rollback відновлює змінені файли і видаляє тільки newly-created файли.
