---
session: b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2
captured: 2026-06-03T10:10:33+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2.jsonl
---

## ADR Заміна `error_log off` на `error_log /dev/null crit` у правилі `nginx-default-tpl`

## Context and Problem Statement
Директива `error_log off;` в nginx-шаблонах трактується як ім'я файлу (`/etc/nginx/off`), а не як відключення логування. Під `readOnlyRootFilesystem` nginx падає при спробі відкрити цей файл. Потрібно змінити канон у правилі `nginx-default-tpl` та автоматично мігрувати наявні `default.conf.template`.

## Considered Options
* Залишити `error_log off;` (поточне, невалідне)
* Замінити на `error_log /dev/null crit;` (`/dev/null` — writable device, `crit` — лише критичні помилки)

## Decision Outcome
Chosen option: "Замінити на `error_log /dev/null crit;`", because `/dev/null` доступний для запису навіть під `readOnlyRootFilesystem`, і рівень `crit` мінімізує обсяг логування — ці аргументи надав користувач у постановці задачі.

### Consequences
* Good, because правило перевірки у `template.mjs:134` тепер відхиляє `error_log off` із чітким повідомленням про причину (`readOnlyRootFilesystem`).
* Good, because нова функція `migrateErrorLogOffDirective()` автоматично виправляє наявні `default.conf.template` при запуску `check()`, не покладаючись на ручне виправлення в кожному проєкті.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/nginx-default-tpl/js/template.mjs`, `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc`, `npm/rules/nginx-default-tpl/js/tests/template/fixtures/default.conf.template`, `npm/rules/nginx-default-tpl/js/tests/template/tests/check.test.mjs`
- Міграція використовує regex `/error_log\s+off\s*;/gu` (обробляє довільні пробіли)
- Патерн функції `migrateErrorLogOffDirective()` повторює наявний `migrateDefaultTplConfFiles()` — запускається з `check()` зі pass-звітом
- Change-файл: `npm/.changes/1780470438809-46704f.md` (`bump: patch`, `section: Fixed`)
- Тести: 50/50 passed (vitest v4.1.7)

---

## ADR Канонічні налаштування `.claude/` зберігаються в `npm/.claude-template/`

## Context and Problem Statement
Після завершення реалізації агент забув додати change-файл. Користувач поставив питання, як зафіксувати це правило так, щоб агент не забував надалі. Розслідування показало, що `.claude/settings.json` генерується з `npm/.claude-template/settings.template.json` через `npm/scripts/sync-claude-config.mjs`.

## Considered Options
* Правити `.claude/settings.json` локально (зникне при синку)
* Правити канон у `npm/.claude-template/settings.template.json` або хуках `npm/.claude-template/hooks/`

## Decision Outcome
Chosen option: "Правити канон у `npm/.claude-template/`", because локальна правка `.claude/settings.json` буде перезаписана при наступному синку; канонічне джерело для хуків і дозволів — `npm/.claude-template/`.

### Consequences
* Good, because зміна в `npm/.claude-template/` поширюється на всі проєкти, що використовують `@nitra/cursor`, через механізм синку.
* Neutral, because transcript не містить підтвердження — конкретний Stop-гейт для changelog у `settings.template.json` на момент закінчення сесії додано не було; сесія завершилась на читанні файлу без commit змін.

## More Information
- Структура: `npm/.claude-template/settings.template.json`, `npm/.claude-template/hooks/capture-decisions.sh`, `npm/.claude-template/hooks/normalize-decisions.sh`
- Синк: `npm/scripts/sync-claude-config.mjs`
- Наявний `n-changelog.mdc` вже містить блок `## STOP` (`alwaysApply: true`), але він покладається на текстову пам'ять агента, а не на детермінований harness-хук
- Додаткової інформації про фінальне рішення щодо конкретного хука в transcript не зафіксовано
