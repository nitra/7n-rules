---
session: 4da5c37e-5cae-4bdf-8551-2b38b038a017
captured: 2026-05-22T13:09:41+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/4da5c37e-5cae-4bdf-8551-2b38b038a017/4da5c37e-5cae-4bdf-8551-2b38b038a017.jsonl
---

## ADR Багаторівнева валідація версій GitHub Actions у `@nitra/cursor`

## Context and Problem Statement
GitHub Actions workflow-файли потребують одночасно перевірки синтаксису, безпеки (pinning тегів) і відповідності канонічним версіям, прийнятим у проєкті (наприклад, обов'язковий `actions/checkout@v6`). Один інструмент не покриває всі три рівні — потрібна розподілена відповідальність.

## Considered Options
* Один інструмент (наприклад, лише actionlint) для всіх рівнів перевірки
* Багаторівнева схема: actionlint + zizmor + conftest/Rego

## Decision Outcome
Chosen option: "Багаторівнева схема: actionlint + zizmor + conftest/Rego", because кожен інструмент покриває окремий шар: actionlint — синтаксис GHA, zizmor — security/ref-pin, conftest/Rego — канонічні версії проєкту.

### Consequences
* Good, because actionlint (`bunx github-actionlint`, команда `bun run lint-ga`) ловить синтаксичні помилки workflow та некоректні `uses:`-посилання.
* Good, because zizmor (`uvx zizmor --offline --collect=workflows .`, конфіг `.github/zizmor.yml`) перевіряє закріплення тегів (`@v4`, `@main`) з точки зору безпеки незалежно від версійної політики проєкту.
* Good, because Rego-полісі в `npm/rules/ga/policy/` разом із template-файлами (`npm/rules/ga/policy/*/template/*.yml`) та JS-перевірками (`npm/rules/ga/lint/lint.mjs`, `npm/scripts/utils/gha-workflow.mjs`) фіксують канонічну версію (`checkout@v6`) і запускаються через `npx @nitra/cursor check ga`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
* Команди: `bun run lint-ga` → `n-cursor lint-ga` → `bunx github-actionlint`; `uvx zizmor --offline --collect=workflows .`; `npx @nitra/cursor check ga`
* Файли: `npm/rules/ga/policy/lint_ga/lint_ga.rego`, `npm/rules/ga/lint/lint.mjs`, `npm/scripts/utils/gha-workflow.mjs`, `.github/zizmor.yml`
* JS cross-file перевірки (наприклад, порядок кроків: checkout перед `setup-bun-deps`, `persist-credentials: false`) реалізовані в `check-ga.mjs` і доповнюють Rego-полісі.
