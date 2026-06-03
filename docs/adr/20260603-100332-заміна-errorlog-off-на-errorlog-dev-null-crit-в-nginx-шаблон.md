---
session: b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2
captured: 2026-06-03T10:03:32+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2.jsonl
---

4 тест-файли пройшли (50 тестів). Всі зміни:

- `js/template.mjs` — нова міграційна функція `migrateErrorLogOffDirective`, check тепер вимагає `error_log /dev/null crit;`, JSDoc оновлено
- `nginx-default-tpl.mdc` — канонічний приклад виправлено
- `fixtures/default.conf.template` — fixture виправлено
- `check.test.mjs` — тест для нової міграції доданий, `migrateErrorLogOffDirective` додано до імпорту

---

## ADR Заміна `error_log off` на `error_log /dev/null crit` в nginx-шаблоні

## Context and Problem Statement
У правилі перевірки nginx (`nginx-default-tpl`) використовувалася директива `error_log off;`, яка є невалідною в nginx: значення `off` трактується як ім'я файлу (тобто `/etc/nginx/off`) і при `readOnlyRootFilesystem` викликає помилку запуску. Потрібна заміна на реально валідний і безпечний варіант.

## Considered Options
* `error_log /dev/null crit;` — переспрямування в `/dev/null` (завжди writable device) з рівнем `crit`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`error_log /dev/null crit;`", because `/dev/null` — це writable character device, доступний навіть при `readOnlyRootFilesystem`, тоді як `off` nginx тлумачить як ім'я файлу і спроба запису в `/etc/nginx/off` у read-only контейнері завершується падінням.

### Consequences
* Good, because nginx коректно стартує в контейнерах із `readOnlyRootFilesystem`, де запис у `/etc/nginx/off` заборонений.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/nginx-default-tpl/js/template.mjs`, `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc`, `npm/rules/nginx-default-tpl/js/tests/template/fixtures/default.conf.template`, `npm/rules/nginx-default-tpl/js/tests/template/tests/check.test.mjs`
- Додано функцію `migrateErrorLogOffDirective` в `template.mjs`, що автоматично замінює `error_log off;` на `error_log /dev/null crit;` у знайдених шаблонах.
- Check-правило (рядок `ok: c => c.includes(...)`) оновлено з `'error_log off'` на `'error_log /dev/null crit'`.
- Тести: `bunx vitest run ... check.test.mjs` — 50/50 passed.
