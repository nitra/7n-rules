---
session: 4da5c37e-5cae-4bdf-8551-2b38b038a017
captured: 2026-05-22T13:29:36+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/4da5c37e-5cae-4bdf-8551-2b38b038a017/4da5c37e-5cae-4bdf-8551-2b38b038a017.jsonl
---

## ADR Rego-полісі для мінімальних версій marketplace actions у GitHub Actions

## Context and Problem Statement
У `@nitra/cursor` вже існує стек лінтингу workflow (`actionlint`, `zizmor`, `conftest`+Rego), але жоден із шарів не перевіряв, що конкретна marketplace action (напр. `Infisical/secrets-action@v1.0.8`) не використовує застарілий runtime Node.js 20 (deprecated GitHub із червня 2026). Потрібно було визначити, який інструмент відповідає за канонічні версії action, і додати відповідну перевірку.

## Considered Options
* **actionlint** — перевіряє лише «знятий з GHA» runner (напр. `node16`); `node20` ще дозволений; неканонічні action (Infisical) поза корпусом «popular actions».
* **zizmor** — security-аудит (`unpinned-uses`, injection, permissions), не читає `runs.using` у чужих action.
* **conftest + Rego** (`ga.workflow_common`) — вже містить канон Nitra; може порівнювати `uses:` кожного кроку з template.

## Decision Outcome
Chosen option: "conftest + Rego у `ga.workflow_common`", because саме цей шар фіксує проєктний канон (checkout, шаблони workflow), й архітектурно це правильне місце для deny-правил на конкретні marketplace versions.

### Consequences
* Good, because перевірка відбувається локально (`npx @nitra/cursor check ga`) до CI, без звернення до GitHub API — файл `template/uses-min-versions.snippet.json` є єдиним джерелом правди.
* Bad, because `actionlint` і `zizmor` залишаються без змін — якщо з'являться нові deprecated runtimes, оновлення потрібно вносити вручну в template.

## More Information
- Новий файл: `npm/rules/ga/policy/workflow_common/template/uses-min-versions.snippet.json`
- Логіка deny: `npm/rules/ga/policy/workflow_common/workflow_common.rego` (функції `action_ref_meets_min`, `version_triple`, `version_gte`)
- Тести: `npm/rules/ga/policy/workflow_common/workflow_common_test.rego`
- Запуск: `npx @nitra/cursor check ga`

---

## ADR Мінімальні версії actions/checkout та Infisical/secrets-action; пом'якшення порогу для checkout

## Context and Problem Statement
`Infisical/secrets-action@v1.0.8` використовує `runs.using: node20` (deprecated з червня 2026). Потрібно зафіксувати мінімальні теги для двох action у `ga.workflow_common`, водночас уникнувши масових змін у споживацьких репо через надто суворе обмеження на patch-версію checkout.

## Considered Options
* **Hard мінімум `actions/checkout >= 6.0.2`** (перший варіант) — вимагає оновлення всіх workflow-файлів у споживацьких репо, де вже стоїть `@v6`.
* **Major-мінімум `actions/checkout >= 6`** + рекомендація `v6.0.2+` в документації — `@v6` дозволено, deny лише для `v5` і нижче.

## Decision Outcome
Chosen option: "major-мінімум `actions/checkout >= 6`", because після реалізації hard-мінімуму `v6.0.2` виявилось, що це спричинило масові зміни у workflow-шаблонах і тестах. Користувач вирішив пом'якшити обмеження: `v6` = OK, `v5` і нижче = deny; `v6.0.2+` залишається рекомендацією в `ga.mdc`.

### Consequences
* Good, because споживацькі репо з `actions/checkout@v6` не потребують жодних змін після оновлення `@nitra/cursor`.
* Bad, because `actions/checkout@v6.0.0` і `v6.0.1` (якщо вони існують і мають `node20`) пройдуть перевірку — transcript не містить підтвердження, чи це практична проблема.

## More Information
- Канон мінімумів: `npm/rules/ga/policy/workflow_common/template/uses-min-versions.snippet.json`
```json
{
"actions/checkout": "6",
"Infisical/secrets-action": "1.0.16"
}
```
- SHA-pin (40-символьний hex) завжди дозволений (`action_ref_is_sha_pin`).
- Версія пакета після змін: `1.13.76` (`npm/package.json`, `npm/CHANGELOG.md`).
- `ga.mdc` версія `1.10`; приклади у документі використовують `actions/checkout@v6`.
- `Infisical/secrets-action@v1.0.16` підтверджено має `runs.using: node24` (WebFetch із GitHub raw у transcript).
