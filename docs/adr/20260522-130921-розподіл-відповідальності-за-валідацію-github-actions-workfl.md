---
session: 4da5c37e-5cae-4bdf-8551-2b38b038a017
captured: 2026-05-22T13:09:21+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/4da5c37e-5cae-4bdf-8551-2b38b038a017/4da5c37e-5cae-4bdf-8551-2b38b038a017.jsonl
---

## ADR Розподіл відповідальності за валідацію GitHub Actions workflows між трьома шарами

## Context and Problem Statement
У монорепо `@nitra/cursor` workflow-файли GHA потребують кількох рівнів перевірки: синтаксичної коректності `uses:`/`run:`, security-аудиту pinning-тегів та відповідності канонічним версіям action (наприклад, обов'язковий `actions/checkout@v6`). Один інструмент не покриває всі ці сценарії одночасно.

## Considered Options
* Єдиний зовнішній лінтер (actionlint) для всіх перевірок
* Розподіл відповідальності: actionlint + zizmor + conftest (Rego)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розподіл відповідальності: actionlint + zizmor + conftest (Rego)", because кожен інструмент покриває окремий шар: actionlint — синтаксична валідність `uses:`, zizmor — security-аудит ref-pinning, conftest/Rego — канонічні версії проєкту.

### Consequences
* Good, because transcript фіксує очікувану користь: `actions/checkout@v4` замість `@v6` буде зловлено саме Rego-полісі (`check ga`), тоді як actionlint не знає про проєктний канон версій.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `bun run lint-ga` → `n-cursor lint-ga` → `bunx github-actionlint` (синтаксис + shellcheck)
- `uvx zizmor --offline --collect=workflows .` з `.github/zizmor.yml` (ref-pin / `unpinned-uses`)
- `npx @nitra/cursor check ga` через `conftest` + Rego в `npm/rules/ga/policy/lint_ga/lint_ga.rego`
- Канонічні шаблони: `npm/rules/ga/policy/*/template/*.yml`
- Допоміжна JS-логіка: `npm/scripts/utils/gha-workflow.mjs`, `npm/rules/ga/lint/lint.mjs`
