---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T20:43:54+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Перехід на changeset-файли замість ручного version bump у feature-гілках

## Context and Problem Statement
При паралельній роботі декількох розробників поточне правило `n-changelog.mdc` вимагає ручного підняття `version` у `package.json` і нової секції в `CHANGELOG.md` у кожному feature-PR. Обидва поля редагуються з однієї бази, що гарантує git-конфлікт при мерджі.

## Considered Options
* Зберегти ручний bump + `merge=union` у `.gitattributes` для `CHANGELOG.md` (швидкий фікс)
* Перевести version bump у release-крок CI (без змін формату чейнджлогу)
* Changeset-файли: кожен PR кладе `.changeset/<slug>.md`, версія і CHANGELOG генеруються на релізі

## Decision Outcome
Chosen option: "Changeset-файли з генерацією на релізі", because підхід прибирає причину конфлікту (два розробники = два різні файли), а не симптом; ручний bump залишається лише для `.changeset/<slug>.md`, що є унікальним файлом і конфліктувати не може.

### Consequences
* Good, because transcript фіксує очікувану користь: `version` і `CHANGELOG.md` більше не редагуються руками в feature-гілках — конфлікт стає неможливим by design.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізується через нову команду `n-cursor changeset`, оновлений STOP-блок у `.cursor/rules/n-changelog.mdc` (v3.0), нову перевірку `check changeset` у `npm/rules/changeset/fix.mjs`. Spec: `docs/superpowers/specs/2026-05-29-n-cursor-release-design.md`. Plan: `docs/superpowers/plans/2026-05-29-n-cursor-release-plan.md`.

---

## ADR Обгортка @changesets/cli замість власного парсера/генератора

## Context and Problem Statement
Для реалізації changeset-флоу потрібен інструмент, що генерує `.changeset/<slug>.md`, парсить ці файли і продукує версійний bump та CHANGELOG. Постало питання: писати власний формат і генератор усередині `n-cursor`, чи інтегруватися з `@changesets/cli`.

## Considered Options
* Власний легкий формат `.changes/*.md` + генератор у `n-cursor` (повний контроль, Python-сумісно)
* Обгортка `@changesets/cli` (менше коду, зріла екосистема)
* Гібрид: формат сумісний із changesets, але парсер власний у `n-cursor`

## Decision Outcome
Chosen option: "Обгортка @changesets/cli", because зменшує обсяг власного коду; формат файлів `.changeset/<slug>.md` залишається сумісним зі стандартом `@changesets/cli`, що дозволяє споживачеві переключитися на нативний CLI без міграції.

### Consequences
* Good, because transcript фіксує очікувану користь: `@changesets/cli` — зріла екосистема з готовим `changesets/action@v1` для CI і нативним форматом, що вже підтримується у bun-монорепо.
* Bad, because `@changesets/cli` — JS-only; Python workspace випадає з scope v1 і обробляється як `warn`, не `error` у `check changeset`.

## More Information
`n-cursor changeset` проксює на `changeset add` якщо `@changesets/cli` встановлений у монорепо; якщо ні — запускає власний мінімальний інтерактив. Ця різниця є прихованою деталлю реалізації: правило `n-changelog.mdc` і агенти завжди використовують лише `n-cursor changeset`. Файл `npm/github-actions/changesets-release/action.yml` обгортає `changesets/action@v1`.

---

## ADR Release PR замість авто-релізу на кожен merge в main

## Context and Problem Statement
Після переходу на changeset-файли потрібно визначити, коли і як CI перетворює накопичені `.changeset/*.md` на реальний version bump, CHANGELOG і npm publish: автоматично після кожного merge або через окремий Release PR з явним аппрувом.

## Considered Options
* Авто-реліз на кожен merge в `main` (якщо є `.changeset/` файли — CI одразу bump + publish)
* «Release PR» — CI тримає відкритий PR «Version Packages», що накопичує чейнджсети; людина мерджить → публікація

## Decision Outcome
Chosen option: "Release PR", because для `@nitra/cursor` (інструмент із реальними споживачами) важлива явна approval-точка релізу: команда бачить прийдешній CHANGELOG і нову версію перед публікацією.

### Consequences
* Good, because transcript фіксує очікувану користь: реліз є свідомою дією, а не побічним ефектом merge; кілька feature-PR акумулюються в один реліз.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізується через новий `.github/workflows/changeset-pr.yml` (job `release-pr`, `permissions: contents: write, pull-requests: write`), що використовує `changesets/action@v1` з `publish: false`. Наявний `npm-publish.yml` спрацьовує після того, як Version Packages PR змерджений і `package.json` вже містить нову версію. Loop-guard: коміт від `GITHUB_TOKEN` через `changesets/action` не тригерить нові workflow-запуски — вбудована GitHub-поведінка.
