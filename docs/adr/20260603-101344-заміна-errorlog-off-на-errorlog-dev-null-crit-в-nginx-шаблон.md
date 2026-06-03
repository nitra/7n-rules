---
session: b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2
captured: 2026-06-03T10:13:44+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2.jsonl
---

## ADR Заміна `error_log off` на `error_log /dev/null crit` в nginx-шаблонах

## Context and Problem Statement
Правило `nginx-default-tpl` вимагало директиви `error_log off;` у канонічному шаблоні. Ця директива є невалідною для nginx: `off` трактується як ім'я файлу (`/etc/nginx/off`), що призводить до краш-запису під `readOnlyRootFilesystem`. `/dev/null` — writable device і уникає цієї проблеми.

## Considered Options
* Залишити `error_log off;` (поточний стан)
* Замінити на `error_log /dev/null crit;`

## Decision Outcome
Chosen option: "Замінити на `error_log /dev/null crit;`", because `error_log off;` — невалідна конструкція nginx, що падає під `readOnlyRootFilesystem`; `/dev/null crit` — єдина безпечна альтернатива для статичних контейнерів з read-only filesystem.

### Consequences
* Good, because правило більше не генерує конфіги, що крашать nginx під `readOnlyRootFilesystem`.
* Good, because авто-міграція `migrateErrorLogOffDirective()` у `template.mjs` виправляє наявні `default.conf.template`-файли без ручного втручання (аналогічно до наявної `migrateDefaultTplConfFiles`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/nginx-default-tpl/js/template.mjs` — нова функція `migrateErrorLogOffDirective()` (regex `/error_log\s+off\s*;/gu`), оновлений check (`c.includes('error_log /dev/null crit')`), виклик міграції з `check()`, оновлений JSDoc.
- `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc` — канонічний приклад замінено, додано коментар про причину невалідності `off`.
- `npm/rules/nginx-default-tpl/js/tests/template/fixtures/default.conf.template` — фікстура оновлена до `error_log /dev/null crit;`.
- `npm/rules/nginx-default-tpl/js/tests/template/tests/check.test.mjs` — додано два тести на `migrateErrorLogOffDirective`.
- `npm/.changes/1780470438809-46704f.md` — change-файл `bump: patch`, `section: Fixed`.

Тести після змін: 50/50 passed (`bunx vitest run`).
