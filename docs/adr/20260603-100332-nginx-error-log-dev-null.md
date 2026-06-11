# nginx-default-tpl: заміна `error_log off` на `error_log /dev/null crit`

**Status:** Accepted
**Date:** 2026-06-03

## Context and Problem Statement
Правило `nginx-default-tpl` вимагало директиви `error_log off;` у `default.conf.template`. Ця директива невалідна в nginx: рядок `off` трактується як ім'я файлу (`/etc/nginx/off`), а не як спеціальне ключове слово — спроба запису при `readOnlyRootFilesystem` призводить до краш-старту контейнера.

## Considered Options
- `error_log /dev/null crit;` — перенаправлення на writable device з фільтрацією лише критичних помилок
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`error_log /dev/null crit;`", because `/dev/null` — writable character device, доступний навіть при `readOnlyRootFilesystem`; `off` nginx тлумачить як шлях до файлу, тому запис у `/etc/nginx/off` у read-only контейнері завершується падінням.

### Consequences
- Good, because nginx коректно стартує в контейнерах із `readOnlyRootFilesystem`, де запис у `/etc/nginx/off` заборонений.
- Good, because нова функція `migrateErrorLogOffDirective()` автоматично виправляє наявні `default.conf.template`-файли без ручного втручання (аналогічно до `migrateDefaultTplConfFiles`).
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/nginx-default-tpl/js/template.mjs` — додано `migrateErrorLogOffDirective()` (regex `/error_log\s+off\s*;/gu`); оновлено check-умову на `c.includes('error_log /dev/null crit')`; виклик міграції з `check()`; оновлено JSDoc.
- `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc` — канонічний приклад замінено; додано коментар про причину невалідності `off`.
- `npm/rules/nginx-default-tpl/js/tests/template/fixtures/default.conf.template` — фікстура оновлена до `error_log /dev/null crit;`.
- `npm/rules/nginx-default-tpl/js/tests/template/tests/check.test.mjs` — два нові кейси на `migrateErrorLogOffDirective` (заміна + no-op).
- `npm/.changes/1780470438809-46704f.md` — change-файл `bump: patch`, `section: Fixed`.
- Тести: 50/50 passed (`bunx vitest run`).
