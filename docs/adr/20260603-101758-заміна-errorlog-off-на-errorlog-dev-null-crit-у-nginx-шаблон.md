---
session: b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2
captured: 2026-06-03T10:17:58+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/b6bfe2b1-7a9a-47f9-9f80-a8bac7833bb2.jsonl
---

## ADR Заміна `error_log off` на `error_log /dev/null crit` у nginx-шаблонах

## Context and Problem Statement
Правило `nginx-default-tpl` вимагало директиви `error_log off;` у `default.conf.template`. Ця директива невалідна в nginx: рядок `off` трактується як ім'я файлу (`/etc/nginx/off`), тому контейнери з `readOnlyRootFilesystem` падають під час старту.

## Considered Options
* `error_log /dev/null crit;` — перенаправлення на writable-пристрій з фільтрацією лише критичних помилок
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`error_log /dev/null crit;`", because `/dev/null` є writable device і не вимагає запису на файлову систему, що сумісно з `readOnlyRootFilesystem`; `off` як значення nginx трактує як шлях до файлу, а не як спеціальне ключове слово.

### Consequences
* Good, because transcript фіксує очікувану користь: контейнери не падають під `readOnlyRootFilesystem`; правило перевірки тепер детектує старий невалідний синтаксис і блокує його через нову check-умову (`c.includes('error_log /dev/null crit')`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/nginx-default-tpl/js/template.mjs` — додано `migrateErrorLogOffDirective()` (regex `/error_log\s+off\s*;/gu`), виклик з `check()`; оновлено check-умову та JSDoc.
- `npm/rules/nginx-default-tpl/nginx-default-tpl.mdc` — канонічний приклад оновлено; додано коментар про причину (`"off"` = ім'я файлу, `/dev/null` — writable device).
- `npm/rules/nginx-default-tpl/js/tests/template/fixtures/default.conf.template` — фікстура приведена до нового канону.
- `npm/rules/nginx-default-tpl/js/tests/template/tests/check.test.mjs` — два нових кейси на `migrateErrorLogOffDirective` (заміна + no-op).
- Всі 50 тестів пройшли після змін: `bunx vitest run … check.test.mjs`.

---

## ADR Архітектура changelog-гейту для крос-харнесного середовища

## Context and Problem Statement
Агент завершив сесію з npm-змінами без change-файлу (`npm/.changes/…`), порушивши `n-changelog.mdc`. Правило реалізоване лише як текст (`alwaysApply: true`) і pre-commit через `hk`, але pre-commit не встановлений (`hk install` не виконано). Постало питання, як примусово забезпечити дотримання правила — у Claude Code, Cursor і pi.dev з моделлю ChatGPT.

## Considered Options
* **Блокуючий `Stop`-hook у `.claude/settings.template.json`** (`exit 2` → Claude Code блокує завершення ходу і повертає stderr агенту)
* **`hk install` як pre-commit** — єдиний крос-харнесний і модель-агностичний гейт; спрацьовує на `git commit` незалежно від харнесу
* **Notify-попередження у pi.dev TS-extension** — через `agent_end` (async, не блокує)
* **Автоматичний виклик `hk install` з CLI `npx @nitra/cursor`** — щоб не вимагати ручного запуску в кожному репо

## Decision Outcome
Chosen option: "`hk install` як universal backstop", because `agent_end` у pi.dev є async і не дозволяє заблокувати хід (transcript: *«Async, не блокує agent_end»*); блокуючий `Stop`-hook діє лише в Claude Code; єдиний рівень, що неможливо обійти незалежно від харнесу й моделі — git pre-commit.

Конкретне рішення про автоматичний виклик `hk install` з CLI `npx @nitra/cursor` на момент закінчення transcript ще **обговорювалося**, не зафіксовано як прийняте.

### Consequences
* Good, because transcript фіксує очікувану користь: pre-commit спрацьовує і для ручних змін, і для Claude, і для Cursor, і для pi+ChatGPT — зміна не проскочить у `git commit` без change-файлу.
* Bad, because блокуючий `Stop`-hook не транслюється в pi.dev через обмеження `agent_end`-події; там можливе лише notify-попередження. Крім того, `hk install` наразі не виконано (`.git/hooks/pre-commit` порожній), тож backstop ще неактивний.

## More Information
- `.cursor/hooks.json` — Cursor-рівень хуків у репо; `agent_end` fire-and-forget, не блокуючий.
- `npm/.claude-template/settings.template.json` — канонічне джерело для `.claude/settings.json`; локальні правки в `.claude/` зникають при наступному `sync-claude-config`.
- `npm/.pi-template/extensions/n-cursor-adr/index.ts` — pi.dev-адаптер; рядки 79–81 коментують async-семантику `agent_end`.
- `hk.pkl` — glob `npm/**` → правило `npm-changelog`; `check changelog` повертає ненульовий код при відсутньому change-файлі.
- Команда для активації backstop: `hk install` у корені репо.
