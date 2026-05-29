# Workflow bundling: bump + CHANGELOG завжди в одному коміті з контентними змінами

**Status:** Accepted
**Date:** 2026-05-25

## Context and Problem Statement

Правило `npm-module/js/package_structure.mjs` вимагає, щоб `version` у `npm/package.json` був вищий за HEAD при наявності незакомічених змін під `npm/`. Коли bump комітиться окремо (без контентних змін), наступна правка знову порушує правило — виникає циклічна залежність.

## Considered Options

* Workflow bundling: bump + CHANGELOG завжди в одному коміті з контентними змінами
* Дозволити «standalone bump-commit» (послаблення правила `package_structure.mjs`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Workflow bundling", because user явно обрав цей варіант; зміна правила збільшила б складність без реальної потреби.

### Consequences

* Good, because жодних змін у коді — правило залишається строгим.
* Bad, because вимагає дисципліни: якщо bump закомічено окремо до push, потрібен `git commit --amend`, що неочевидно.

## More Information

- Якщо bump закомічено окремо до push: `git add -A && git commit --amend --no-edit`.
- Якщо треба зберегти прогрес без bump: `git stash -u`.
- Anti-pattern: `git commit -m "1.18.1"` із самим `package.json` + `CHANGELOG.md` — наступна правка знову вимагатиме bump.
- Додаткової інформації про зміну коду в transcript не зафіксовано.
