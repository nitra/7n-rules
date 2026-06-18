---
type: ADR
title: "Розмежування CLI-дієслова `fix` і модульних concern-файлів `check.mjs`"
---

# Розмежування CLI-дієслова `fix` і модульних concern-файлів `check.mjs`

**Status:** Accepted
**Date:** 2026-05-23

## Context and Problem Statement

Після перейменування CLI-команди `check` → `fix` (коміт `68b3f6f`) кодова база містила два типи згадок слова `check`: посилання на CLI-дієслово та посилання на модульні concern-файли `rules/<id>/js/<concern>/check.mjs`. Автоматична міграція ризикувала перейменувати concern-файли, порушивши їхні імпорти у тестах. Паралельно потрібно було вирішити долю slash-команди `n-check.md` і застарілих шляхів у `conftest.mdc`.

## Considered Options

- Перейменувати всі згадки `check` — CLI + concern-файли
- Перейменувати лише CLI-дієслово, залишити concern-файли `check.mjs` без змін
- Залишити `n-check.md` як deprecated alias з текстом «дивись `/n-fix`»
- Видалити `n-check.md` повністю
- Оновити `conftest.mdc` в одному проході з CLI-міграцією
- Оновити `conftest.mdc` окремою задачею
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Перейменувати лише CLI-дієслово + видалити `n-check.md` + оновити `conftest.mdc` в одному проході", because concern-файли `rules/<id>/js/<concern>/check.mjs` є модульними утилітами перевірки без мутацій, а не CLI-verbами — їхня роль не змінилась; збереження `n-check.md` підтримувало б неактуальну термінологію, оскільки `n-fix.md` вже охоплює ту саму функцію; об'єднання `conftest.mdc`-оновлення в один прохід запобігає розсинхронізації між документацією правил і фактичними шляхами.

### Consequences

- Good, because агент явно розмежував дві категорії перед внесенням змін, що запобігло неправомірному перейменуванню concern-файлів і порушенню їхніх імпортів у тестах
- Good, because синк-тест `sync-claude-config.test.mjs` переписано під «без slash-команд» і пройшов 20/20
- Good, because після змін `grep` на `check-<rule>`, `npm/policy/`, `check abie` у `conftest.mdc` повертає порожній результат
- Bad, because transcript не містить підтверджених негативних наслідків

## More Information

Категорія A — замінити CLI-посилання: `AGENTS.md`, `.claude/settings.json`, `.claude/commands/n-check.md`, `npm/bin/n-cursor.js:8-10`, `npm/scripts/claude-stop-hook.mjs:3`, `.cursor/rules/conftest.mdc`, `docs/fix-cursor-skill.md`.
Категорія B — залишити без змін: `npm/tests/integration-repo-checks.test.mjs`, `npm/scripts/utils/check-reporter.mjs`, concern-файли `rules/<id>/js/<concern>/check.mjs`.
Видалені файли: `.claude/commands/n-check.md`, `npm/.claude-template/commands/n-check.md`.
Генератор `npm/scripts/build-agents-commands.mjs` вже випускав `fix`, тому `AGENTS.md` не потребував ручного оновлення.
Оновлений `conftest.mdc`: `policyDirRel` → `npm/rules/<rule>/policy/`; `check-<rule>.mjs` → `rules/<rule>/js/<concern>/check.mjs`; CLI-приклади `check abie/ga` → `fix abie/ga`.
Версія після сеансу: `@nitra/cursor` `1.13.89`.

## Update 2026-06-05

`run-rule.mjs` є print-only orchestrator: запускає `checkSnippet`/`checkContains`/`checkDeny`, виводить `❌`/`✅`, але ніколи не пише файли. Запис — крок 3 скіла `n-fix`, де агент читає `❌`-рядки й застосовує зміни. Якщо агент пропустив `❌`-рядок або скіл не запускався end-to-end, порушення залишається без виправлення до наступного повного запуску `n-fix`.

- `npm/scripts/lib/run-rule.mjs` рядки 1–40 — логіка applies-gate + print-only
- Практичний приклад: відсутній крок `Release (bump + CHANGELOG + tag)` у `npm-publish.yml` виявлено через `❌ npm_publish_yml: ...`; виправлено агентом у worktree `.worktrees/main-fix`; після виправлення: `✅ npm_publish_yml: відповідає канону (template subset)`
