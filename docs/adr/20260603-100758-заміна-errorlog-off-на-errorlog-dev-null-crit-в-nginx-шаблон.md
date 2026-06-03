---
session: b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2
captured: 2026-06-03T10:07:58+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2.jsonl
---

## ADR Заміна `error_log off` на `error_log /dev/null crit` в nginx-шаблоні

## Context and Problem Statement
Правило `nginx-default-tpl` перевіряло та вимагало директиву `error_log off;` у `default.conf.template`. Директива `error_log off;` є невалідною в nginx: `off` трактується як ім'я файлу (`/etc/nginx/off`), що спричиняє падіння під `readOnlyRootFilesystem`. `/dev/null` — writable device і є коректним рішенням.

## Considered Options
* Замінити `error_log off;` на `error_log /dev/null crit;`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити `error_log off;` на `error_log /dev/null crit;`", because `error_log off` — НЕ валідний nginx і падає під `readOnlyRootFilesystem`, тоді як `/dev/null` є writable device і коректно пригнічує логування помилок.

### Consequences
* Good, because шаблон більше не генерує невалідну конфігурацію nginx, що могло призводити до краш-стартів контейнерів із `readOnlyRootFilesystem`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/nginx-default-tpl/js/template.mjs`: додано функцію `migrateErrorLogOffDirective()` — авто-заміна через regex `/error_log\s+off\s*;/gu` у всіх знайдених `default.conf.template`; виклик з `check()`; оновлено правило перевірки (вимагає `error_log /dev/null crit`).
- `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc`: канонічний приклад оновлено на `error_log /dev/null crit;` з поясненням.
- `npm/rules/nginx-default-tpl/js/tests/template/fixtures/default.conf.template`: фікстура оновлена.
- `npm/rules/nginx-default-tpl/js/tests/template/tests/check.test.mjs`: додано два тест-кейси на `migrateErrorLogOffDirective`.
- change-file: `npm/.changes/1780470438809-46704f.md`, bump `patch`, section `Fixed`.
- Тести: 50/50 passed (`bunx vitest run`).
