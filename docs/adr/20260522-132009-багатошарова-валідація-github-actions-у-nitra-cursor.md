---
session: 4da5c37e-5cae-4bdf-8551-2b38b038a017
captured: 2026-05-22T13:20:09+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/4da5c37e-5cae-4bdf-8551-2b38b038a017/4da5c37e-5cae-4bdf-8551-2b38b038a017.jsonl
---

## ADR Багатошарова валідація GitHub Actions у @nitra/cursor

## Context and Problem Statement
Проєкт `@nitra/cursor` потребує перевірки workflow-файлів GitHub Actions на кількох рівнях: синтаксична коректність `uses:`, безпека закріплення тегів і відповідність канонічним версіям проєкту (наприклад, обов'язковий `actions/checkout@v6`). Жоден з існуючих зовнішніх інструментів не покриває всі ці рівні одночасно.

## Considered Options
* Один інструмент для всієї валідації (`actionlint` або `zizmor`)
* Багатошарова схема: `actionlint` (синтаксис) + `zizmor` (security/pinning) + `conftest` + Rego (канонічні версії проєкту)

## Decision Outcome
Chosen option: "Багатошарова схема", because кожен інструмент вирішує свій клас задачі: `actionlint` (`bun run lint-ga` → `bunx github-actionlint`) ловить синтаксичні помилки та знятий runtime (`node16`); `zizmor` (`uvx zizmor --offline --collect=workflows .`) перевіряє `unpinned-uses` та security-політику через `.github/zizmor.yml`; `conftest` + Rego (`npx @nitra/cursor check ga`) фіксує канонічні версії проєкту (зокрема `checkout@v6` через template у `npm/rules/ga/policy/*/template/*.yml`).

### Consequences
* Good, because кожен шар залишається простим і доменно-специфічним; Rego-поліс (`lint_ga`, `workflow_common`, `lint_js_yml`) декларативно описує канон без дублювання логіки `actionlint`.
* Bad, because схема **не покриває** перевірку `runs.using:` у метаданих третіх-party actions (наприклад, `Infisical/secrets-action@v1.0.8` використовує `node20`, deprecated з червня 2026) — для цього потрібен окремий крок із резолюцією `action.yml` через GitHub API/кеш.

## More Information
- Команда запуску: `bun run lint-ga` → `n-cursor lint-ga` → `bunx github-actionlint` + `uvx zizmor --offline --collect=workflows .`
- Rego-поліси: `npm/rules/ga/policy/lint_ga/lint_ga.rego`, `npm/rules/ga/policy/workflow_common/`, `npm/rules/ga/policy/lint_js_yml/`
- Перевірка канону: `npx @nitra/cursor check ga`
- JS cross-file валідація: `npm/scripts/utils/gha-workflow.mjs` (порядок `checkout` перед `setup-bun-deps`, `persist-credentials: false`)
- Виявлений gap: `Infisical/secrets-action@v1.0.8` → `runs.using: node20`; навіть `v1.0.12` (останній release) лишається на `node20`; `node24` є лише на `main`-гілці репо. Варіанти закриття gap: (1) `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` у test job; (2) новий крок у `check ga` з резолюцією `action.yml` per `uses:`; (3) очікування офіційного оновлення actionlint. Рішення щодо вибору в transcript не зафіксовано.
