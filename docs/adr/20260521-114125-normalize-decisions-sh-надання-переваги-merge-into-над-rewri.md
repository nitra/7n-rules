---
session: 80abf597-8729-4100-8d58-bfd055cc4aa2
captured: 2026-05-21T11:41:25+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/80abf597-8729-4100-8d58-bfd055cc4aa2.jsonl
---

## ADR normalize-decisions.sh: надання переваги `merge-into` над `rewrite` для наявних ADR

## Context and Problem Statement

У пакеті `@nitra/cursor` хук `.claude/hooks/normalize-decisions.sh` нормалізує чернетки ADR через LLM. У черговому батчі 3 з 10 операцій `merge-into` були пропущені (`skip merge-into: target missing`), бо (1) промпт суперечив сам собі: дозволяв цілити `merge-into` у slug сусідньої `rewrite`-операції того ж батча, але потім забороняв вигадувати target поза списком вже наявних clean-файлів; (2) apply-логіка не вміла резолвити target, який щойно створила `rewrite` у тому ж масиві операцій; (3) не існувало fallback для наявних clean-файлів з timestamp-префіксом. Результат — LLM у сумнівних ситуаціях обирав безпечніший `rewrite` й щоразу створював новий файл замість розширення вже наявного ADR.

## Considered Options

* Адаптувати LLM-промпт (принцип вибору операції) + двопрохідна apply-логіка з розумним резолвингом `target`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Адаптувати LLM-промпт + двопрохідна apply-логіка", because це усуває всі три кореневі причини без зміни зовнішнього інтерфейсу скрипта.

Конкретні зміни в `normalize-decisions.sh`:
- **Промпт** — додано абзац "Принцип вибору операції": перш ніж обрати `rewrite`, порівняти тему драфта зі clean-списком і рештою батча; якщо рішення по суті вже зафіксоване — обирати `merge-into`. `rewrite` — лише для справді нового рішення. Правило про `target` переписано: він може бути **(а)** файлом зі списку clean-файлів, **(б)** `<slug>.md` `rewrite`-операції цього ж батча (timestamp-префікс додасть скрипт), або **(в)** унікальним clean-файлом, що закінчується на `-<slug>.md`.
- **Apply-логіка** — двопрохідне застосування: прохід 1 виконує `delete` + `rewrite` і будує мапу `slug → реальний шлях`; прохід 2 виконує `merge-into` з резолвингом target по черзі через (а) точну назву в `docs/adr/`, (б) slug-мапу батча, (в) суфіксний пошук серед наявних clean-файлів.

### Consequences

* Good, because end-to-end тест зі синтетичними чернетками підтвердив: усі 4 операції (`rewrite`, `merge-into` у slug батча, `merge-into` у suffix-match наявного ADR, `delete`) застосовані в правильному порядку без пропусків.
* Good, because transcript фіксує очікувану користь: `changelog`- та `adr`-перевірки пройшли після внесення змін.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли:
- `npm/.claude-template/hooks/normalize-decisions.sh` — джерело (60 рядків diff)
- `.claude/hooks/normalize-decisions.sh` — синхронізована копія (`cp` + `diff` підтвердив `IDENTICAL`)
- `npm/package.json` — `"version": "1.13.67"` → `"1.13.68"`
- `npm/CHANGELOG.md` — додано запис `## [1.13.68] - 2026-05-21 / Changed`

Перевірка: `bash -n` на обох файлах — OK; `bun ./npm/bin/n-cursor.js check changelog` — ✅; `bun ./npm/bin/n-cursor.js check adr` — ✅.
