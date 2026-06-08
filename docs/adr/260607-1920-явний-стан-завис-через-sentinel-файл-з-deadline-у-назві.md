---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T19:20:32+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Всі зміни внесено. Підсумок:

- `running_until_<ts>` додано в file contract (git-ignored, deadline в імені файлу)
- Стан `stalled` додано в таблицю станів і enum у заголовку документа
- `running` тепер = `running_until_<ts>` існує + ts > now()
- `stalled` = `running_until_<ts>` існує + ts ≤ now() — вище `running` у пріоритеті
- Wrapper пише sentinel при старті (крок 3a), видаляє при success і failed cleanup
- `graph kill` (крок 5) видаляє `running_until_*`
- `n-cursor watch` виявляє `stalled` вузли через filename parse без читання вмісту

---

Ось ADR для цієї сесії:

## ADR Явний стан "завис" через sentinel-файл з deadline у назві

## Context and Problem Statement
Система відстежує стан вузлів через наявність файлів у директорії. Стан `running` визначався лише існуванням worktree-директорії, без можливості виявити "завис" (deadline перевищено) без читання вмісту файлів або mtime worktree.

## Considered Options
* Implicit stall detection: watch аналізує mtime worktree + читає `budget_hard_sec` з `task.md`/`plan_NNN.md`
* Sentinel-файл `running_until_<ts>` у task-директорії з deadline у назві (git-ignored)
* `stalled`-sentinel (порожній файл) що пише watch при виявленні

## Decision Outcome
Chosen option: "sentinel-файл `running_until_<ts>`", because wrapper знає deadline у момент старту (`created_at + budget_hard_sec`) і може закодувати його в імені файлу — `stalled` vs `running` стає O(1) filename parse без читання вмісту.

### Consequences
* Good, because виявлення `stalled` не потребує читання вмісту — `ts` у назві файлу, порівняння з `now()`
* Good, because файл видимий у директорії вузла поряд з іншими файлами — перший клас у дизайні
* Good, because видалення при cleanup (success, failed, kill) є атомарним і явним кроком wrapper

## More Information
Файл: `tasks/<node>/running_until_<unix_ts>` (git-ignored через `.n-cursor/` або `.gitignore`)
Пишеться: wrapper крок 3a після `git worktree add`
Видаляється: wrapper крок 9 (success), крок 10 (failed/timeout), `graph kill` крок 5
Стан `stalled` = присутній + `ts` ≤ `Date.now()/1000`; пріоритет вище `running` у state machine
