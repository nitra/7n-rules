---
session: ea881c04-dcf0-4753-a405-2366550a0911
captured: 2026-05-21T14:55:31+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/ea881c04-dcf0-4753-a405-2366550a0911.jsonl
---

## ADR Видалення `Co-Authored-By` трейлера з комітів ADR-нормалізації

## Context and Problem Statement
Під час пакетної нормалізації ADR-чернеток коміти формувалися з рядком `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Auto-mode класифікатор Claude Code заблокував такий коміт, вказавши на порушення Content Integrity / Impersonation через неправильне зазначення ідентичності агента.

## Considered Options
* Зберегти `Co-Authored-By` трейлер у повідомленні коміту
* Виконувати коміти без `Co-Authored-By` трейлера

## Decision Outcome
Chosen option: "Виконувати коміти без `Co-Authored-By` трейлера", because auto-mode класифікатор заблокував коміт через ризик impersonation — вказівка конкретної версії моделі у трейлері розцінюється як фальсифікація ідентичності агента.

### Consequences
* Good, because transcript фіксує очікувану користь: коміти проходять без блокування класифікатором.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Заблокований коміт: `git commit -q -m "adr: normalize batch\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"`. Успішний коміт одразу після: `git commit -q -m "adr: normalize batch"` → `bb28aaf`. Файли в `docs/adr/`.

---

## ADR Ручний запуск ADR-нормалізації через env-змінні оверрайду

## Context and Problem Statement
Скрипт `.claude/hooks/normalize-decisions.sh` має вбудоване обмеження на мінімальний інтервал між запусками (`ADR_NORMALIZE_MIN_INTERVAL_HOURS`, за замовчуванням 21600 с) та поріг кількості чернеток (`ADR_NORMALIZE_THRESHOLD`). При ручній нормалізації накопиченого боргу (66 чернеток) ці обмеження необхідно обходити.

## Considered Options
* `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 bash .claude/hooks/normalize-decisions.sh`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Передача `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0` як env-змінних перед запуском скрипта", because скіл `.cursor/skills/n-adr-normalize/SKILL.md` описує саме цей спосіб обходу порогу й min-interval для ручного прогону.

### Consequences
* Good, because transcript фіксує очікувану користь: 9 послідовних батчів по 10 чернеток успішно оброблено без блокування rate-limit логікою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команда: `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 bash .claude/hooks/normalize-decisions.sh`. Dry-run варіант додає `ADR_NORMALIZE_DRY=1`. Лог: `.claude/hooks/normalize-decisions.log`. Оброблені файли: `docs/adr/`. Всього виконано 9 батчів, 66→1 чернеток, 9 комітів (`7c62d53`…`35a6d72`).
