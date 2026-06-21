---
session: 45a1997b-a862-4bad-aa42-299f0ed8f886
captured: 2026-06-20T09:23:28+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/45a1997b-a862-4bad-aa42-299f0ed8f886.jsonl
---

Немає дозволу на запис у `docs/adr/`. Ось три ADR-блоки для ручного збереження або надання дозволу:

---

## ADR Уніфікація CI-команд на bare `n-cursor lint <rule> --read-only`

## Context and Problem Statement
У CI-воркфлоу (`lint-ga.yml`, `lint-text.yml`, `lint-js.yml`, `lint-style.yml`) та їхніх Rego-шаблонах використовувалися різнорідні команди: `bun run lint-ga`, `bunx oxlint && bunx eslint ...`, `npx stylelint`, `n-cursor lint-text --read-only` (з дефісом замість пробілу). Це порушувало принцип єдиної точки входу і ускладнювало синхронізацію канону між template, rego та CI.

## Considered Options
* bare `n-cursor lint <rule> --read-only` (єдина точка, підкоманда через пробіл)
* `bun run lint-<rule>` (через обгортку з package.json)
* `bunx <tool>` безпосередньо (без n-cursor)

## Decision Outcome
Chosen option: "bare `n-cursor lint <rule> --read-only`", because користувач явно вибрав цей стандарт і зазначив, що `text` треба перевести з `lint-text` (дефіс) на `lint text` (пробіл — підкоманда). `ensureTool('conftest')` авто-встановлює conftest у CI, тому явні install-кроки не потрібні.

### Consequences
* Good, because transcript фіксує очікувану користь: усі 4 воркфлоу, їхні template-снапшоти та rego-тести пройшли conftest (22/22).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `.github/workflows/lint-{ga,text,js,style}.yml`; `npm/rules/{ga,text,js-lint,style-lint}/policy/*/lint_*_{test,}.rego`; template-снапшоти. `.cursor/rules/n-{ga,text,js-lint,style-lint}.mdc` — mirror'и, оновлені через регенерацію. Коміт: `9ba26f57`.

---

## ADR Повна чистка lint-* обгорток — єдина точка `n-cursor lint`, без umbrella `lint` у package.json

## Context and Problem Statement
Кореневий `package.json` містив umbrella-скрипт `lint` (bun-ланцюг усіх `lint-*` + oxfmt) та окремі обгортки `lint-js`, `lint-ga`, `lint-text`, `lint-style`, `lint-security`, `lint-rego`. `bun.package_json.rego` вимагав цього агрегатора й усіх per-rule скриптів. Після введення `n-cursor lint <rule>` обгортки стали зайвою інфраструктурою.

## Considered Options
* Повна чистка: прибрати `lint` і всі `lint-*` обгортки; переписати package_json-вимоги для всіх правил
* A-скорочена: прибрати лише umbrella `lint` + bun-агрегат, лишити per-rule аліаси як зручність
* Залишити все як є

## Decision Outcome
Chosen option: "Повна чистка", because користувач явно обрав A-повну після пояснення обсягу (~10 правил). Кінцевий стан `package.json#scripts`: тільки `start`, `test`, `coverage`.

### Consequences
* Good, because transcript фіксує очікувану користь: bun-конформність пройшла (exit 0), `bun.package_json.rego` агрегат-секцію видалено, 2428 тестів пройшло.
* Bad, because docker і python package_json-вимоги довелося відкотити: їхні CI-политики ще хардкодять `bun run lint-docker`/`lint-python`, тому були б у напівзламаному стані. Відкладено на окрему міграцію.

## More Information
Видалені теки: `npm/rules/ga/policy/package_json`, `npm/rules/rego/policy/package_json` (повністю). Змінені: `npm/rules/bun/policy/package_json/package_json.rego` (прибрано агрегат-секцію), `npm/rules/js-lint/policy/package_json/template/package.json.snippet.json` (прибрано `lint-js`), `npm/rules/style-lint/policy/package_json/package_json.rego` (прибрано contains-блок), `npm/rules/security/policy/package_json/{package_json.rego,template}`. Коміт ядра: `afa24467`. Фікси регресій: `9dc2be76`.

---

## ADR Правити джерельні `npm/rules/*/*.mdc`, регенерувати `.cursor/rules/n-*.mdc` через `inlineTemplateLinks`

## Context and Problem Statement
`.cursor/rules/n-*.mdc` є похідними файлами (mirror'ами), що генеруються з `npm/rules/*/*.mdc` через `inlineTemplateLinks`. У сесії виявлено, що правка mirror'ів напряму (без регенерації) накопичує drift, який mirror-parity конформність фіксує. Також виявлено pre-existing drift у `js-lint-ci`, `js-run`, `vue`, `test`, `worktree` від попередньої роботи.

## Considered Options
* Правити джерела (`npm/rules/*/*.mdc`) + регенерувати mirror'и через `listManagedMirrors`/`inlineTemplateLinks`
* Правити `.cursor/rules/n-*.mdc` безпосередньо (без регенерації)

## Decision Outcome
Chosen option: "Правити джерела + регенерувати mirror'и", because прямий запис у mirror'и порушував mirror-parity конформність; `n-cursor sync` має side-effects self-upgrade, тому регенерація виконувалась напряму через node-скрипт з `listManagedMirrors`/`inlineTemplateLinks`.

### Consequences
* Good, because transcript фіксує очікувану користь: після регенерації drift = none (12 mirror'ів оновлено, включно з pre-existing drift).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Функції: `listManagedMirrors()`, `inlineTemplateLinks()` у `npm/scripts/lib/mirror-parity.mjs` та `npm/scripts/lib/inline-template-links.mjs`. Перевірка drift: `node --input-type=module -e "import { findMirrorDrift } from './npm/scripts/lib/mirror-parity.mjs'; ..."`. Правило: дефолтний `n-cursor sync` апгрейдить пакет і має side-effects — регенеруй inline-снапшоти через `inlineTemplateLinks` напряму. Коміт mdc: `3f722658`.
