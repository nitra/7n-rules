---
session: ad2778ec-2972-4dc6-84de-95c0327ff501
captured: 2026-05-23T23:13:26+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/ad2778ec-2972-4dc6-84de-95c0327ff501.jsonl
---

## ADR Розмежування CLI-дієслова `fix` і модульних concern-файлів `check.mjs`

## Context and Problem Statement
Після коміту `68b3f6f` CLI-команда `npx @nitra/cursor check` перейменована на `fix`, але кодова база містила два типи згадок: посилання на CLI-дієслово та посилання на concern-файли `rules/<id>/js/<concern>/check.mjs`. Постало питання, де саме мигрувати іменування.

## Considered Options
* Перейменувати всі згадки `check` (CLI + concern-файли)
* Перейменувати лише CLI-дієслово, залишити concern-файли без змін

## Decision Outcome
Chosen option: "Перейменувати лише CLI-дієслово, залишити concern-файли без змін", because concern-файли `rules/<id>/js/<concern>/check.mjs` є модульними утилітами, не CLI-verbами; їх ім'я відповідає ролі (перевірка без мутацій), яка не змінилась.

### Consequences
* Good, because transcript фіксує очікувану користь: агент явно розмежував дві категорії у звіті перед внесенням змін, що запобігло неправомірному перейменуванню concern-файлів і порушенню їхніх імпортів у тестах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Категорія A (замінити): `AGENTS.md`, `.claude/settings.json`, `.claude/commands/n-check.md`, `npm/bin/n-cursor.js:8-10`, `npm/scripts/claude-stop-hook.mjs:3`, `npm/rules/image-compress/js/package_setup/check.mjs`, `.cursor/rules/conftest.mdc`, `docs/fix-cursor-skill.md`. Категорія B (залишити): `npm/tests/integration-repo-checks.test.mjs`, `npm/scripts/utils/check-reporter.mjs`, concern-файли `rules/<id>/js/<concern>/check.mjs`.

---

## ADR Видалення `n-check.md` замість збереження як deprecated alias

## Context and Problem Statement
Після перейменування CLI-команди `check` → `fix` існував slash-command файл `.claude/commands/n-check.md` (і темплейт `npm/.claude-template/commands/n-check.md`), що дублював вже наявний `n-fix.md`.

## Considered Options
* Залишити `n-check.md` як deprecated alias з текстом «див. `/n-fix`»
* Видалити `n-check.md` повністю

## Decision Outcome
Chosen option: "Видалити `n-check.md` повністю", because `n-fix.md` вже існує і охоплює ту саму функцію; збереження deprecated файлу підтримувало б неактуальну термінологію.

### Consequences
* Good, because transcript фіксує очікувану користь: синк-тест `sync-claude-config.test.mjs` переписано під «без slash-команд» і пройшов 20/20.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені файли: `.claude/commands/n-check.md`, `npm/.claude-template/commands/n-check.md`. Тест: `npm/scripts/tests/sync-claude-config.test.mjs` (20 pass). Генератор `npm/scripts/build-agents-commands.mjs` вже випускає `fix`, тому `AGENTS.md` не потребував ручного оновлення.

---

## ADR Оновлення `conftest.mdc`: архітектурні посилання на `rules/<id>/policy/` замість `npm/policy/`

## Context and Problem Statement
`conftest.mdc` описував архітектуру Rego-перевірок за допомогою старих шляхів (`npm/policy/<rule>/`, `check-<rule>.mjs`) та прикладів (`check abie`, `check ga`), які не відповідали реальній структурі після мігрції `rules/<id>/policy/` і перейменування `fix.mjs`.

## Considered Options
* Оновити `conftest.mdc` у тому самому проході, що й CLI-міграцію
* Оновити `conftest.mdc` окремою задачею

## Decision Outcome
Chosen option: "Оновити `conftest.mdc` у тому самому проході, що й CLI-міграцію", because користувач явно підтвердив «в межах цього ж проходу», щоб уникнути розсинхронізації між документацією правил і фактичними шляхами.

### Consequences
* Good, because transcript фіксує очікувану користь: після змін `grep` на `check-<rule>`, `npm/policy/`, `check abie` у `conftest.mdc` повертає порожній результат.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Оновлені шаблони в `conftest.mdc`: `policyDirRel` тепер `npm/rules/<rule>/policy/`; `check-<rule>.mjs` → `rules/<rule>/js/<concern>/check.mjs`; приклади CLI `check abie/ga` → `fix abie/ga`; `lint-rego.mjs` шлях виправлено на `npm/rules/`. Версія пакету після цього сеансу: `1.13.89` (`npm/package.json`, `npm/CHANGELOG.md`).
