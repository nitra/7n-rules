---
session: 4da5c37e-5cae-4bdf-8551-2b38b038a017
captured: 2026-05-22T13:29:39+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/4da5c37e-5cae-4bdf-8551-2b38b038a017/4da5c37e-5cae-4bdf-8551-2b38b038a017.jsonl
---

## ADR Rego-політика мінімальних версій marketplace actions у `ga.workflow_common`

## Context and Problem Statement
`Infisical/secrets-action@v1.0.8` (і нижчі теги) використовують `runs.using: node20`, deprecated з червня 2026. Жоден із наявних шарів перевірки (actionlint, zizmor, conftest+Rego) не ловив застарілий runtime у third-party action: actionlint перевіряє лише загальновідомі «popular actions», zizmor фокусується на security-pinning, а Rego-полісі `check ga` порівнюють структуру workflow з шаблоном, але не резолвять `action.yml` для кожного `uses:`.

## Considered Options
* Покладатися на GitHub runner annotations (видно лише при запуску job, не локально/в CI pipeline)
* Новий Rego-deny у `ga.workflow_common` з JSON-канон у `template/uses-min-versions.snippet.json`
* Окремий скрипт, що резолвить `action.yml` через GitHub API для кожного `uses:` та перевіряє `runs.using`

## Decision Outcome
Chosen option: "Rego-deny у `ga.workflow_common` з JSON-канон", because це дає локальну перевірку через `npx @nitra/cursor check ga` без виклику зовнішніх API, а JSON-файл `template/uses-min-versions.snippet.json` є єдиним місцем для оновлення канону.

### Consequences
* Good, because порушення `Infisical/secrets-action@v1.0.8` і `actions/checkout@v5` ловляться локально на рівні `conftest deny` до push у GitHub.
* Bad, because transcript не містить підтверджених негативних наслідків; однак перевірка охоплює лише actions, перелічені в `uses-min-versions.snippet.json`, а не весь marketplace.

## More Information
- Канон версій: `npm/rules/ga/policy/workflow_common/template/uses-min-versions.snippet.json`
- Rego deny-правило: `npm/rules/ga/policy/workflow_common/workflow_common.rego`
- Тести: `npm/rules/ga/policy/workflow_common/workflow_common_test.rego`
- Оркестратор: `npm/rules/ga/fix/workflows/check.mjs` (передає template у `runConftestBatch`)
- Версія пакета: `1.13.76`; запис у `npm/CHANGELOG.md`

---

## ADR Мінімальна версія `actions/checkout` — major `v6`, не `v6.0.2`

## Context and Problem Statement
Перша реалізація зафіксувала hard deny для `actions/checkout` нижче `v6.0.2` і масово замінила `checkout@v6` → `checkout@v6.0.2` у `.github/workflows/*.yml`, шаблонах пакета, тестових файлах і `gha-workflow.mjs`. Це спричинило великий diff у споживацьких репо без вагомої причини для жорсткого обмеження — `@v6` (major tag) відповідає вимозі «не Node.js <6».

## Considered Options
* `actions/checkout` мінімум `v6.0.2` (hard deny, масова заміна)
* `actions/checkout` мінімум major `v6` (deny лише для v5 і нижче), `v6.0.2+` — рекомендація в документації
* Прибрати `actions/checkout` з `uses-min-versions.snippet.json` зовсім

## Decision Outcome
Chosen option: "мінімум major `v6`", because `@v6` (без minor/patch) вже означає major-версію з Node 24 у runtime; масова заміна на `v6.0.2` по всьому репо не давала додаткової safety-гарантії, але збільшувала diff і потребувала оновлень у споживацьких репо.

### Consequences
* Good, because transcript фіксує очікувану користь: скасовано масовий diff у `.github/workflows/*.yml`, шаблонах пакета та тестах; `actions/checkout@v6` залишається валідним без порушень.
* Bad, because `actions/checkout@v6.0.0` або `v6.0.1` (гіпотетично) пройде deny, хоча `v6.0.2` може мати патч-виправлення — transcript не містить підтвердження, що такі версії існують або є проблемними.

## More Information
- Фінальний канон: `"actions/checkout": "6"` у `template/uses-min-versions.snippet.json`
- Semver-порівняння: `[6,0,0]` ≥ `[6,0,0]` → OK; `[5,*,*]` < `[6,0,0]` → deny
- SHA-pin (40-символьний hex) явно виключено з перевірки (`action_ref_is_sha_pin`)
- Рекомендація `v6.0.2+` (Node 24 runtime) залишена в `ga.mdc` як текстова примітка, не як deny
