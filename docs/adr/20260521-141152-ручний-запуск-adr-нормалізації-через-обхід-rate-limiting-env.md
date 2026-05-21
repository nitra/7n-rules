---
session: ea881c04-dcf0-4753-a405-2366550a0911
captured: 2026-05-21T14:11:53+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/ea881c04-dcf0-4753-a405-2366550a0911.jsonl
---

## ADR Ручний запуск ADR-нормалізації через обхід rate-limiting env-змінних

## Context and Problem Statement
Скрипт `.claude/hooks/normalize-decisions.sh` має вбудований захист від частого запуску: `ADR_NORMALIZE_THRESHOLD` (мінімальна кількість чернеток) і `ADR_NORMALIZE_MIN_INTERVAL_HOURS` (мінімальний інтервал між запусками). Ці обмеження заважають запустити нормалізацію вручну поза межами автоматичного хука, коли оператор хоче обробити накопичені чернетки негайно (66 чернеток у `docs/adr/`).

## Considered Options
* Виставити `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0` перед запуском скрипта
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виставити `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0` перед запуском скрипта", because скрипт вже підтримує ці env-змінні як механізм override — жодних змін у коді не потрібно, достатньо явно передати їх у shell-команді.

### Consequences
* Good, because transcript фіксує очікувану користь: три послідовних батчі по 10 чернеток виконались успішно (commits `7c62d53`, `c45b8c9`, `f3ddb9e`), без змін у самому скрипті.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда dry-run: `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 ADR_NORMALIZE_DRY=1 bash .claude/hooks/normalize-decisions.sh`
- Команда реального прогону: `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 bash .claude/hooks/normalize-decisions.sh`
- Скрипт: `.claude/hooks/normalize-decisions.sh`; лог: `.claude/hooks/normalize-decisions.log`
- Модель LLM: `claude` CLI, модель `sonnet`; розмір батчу: 10 чернеток за один прогон
- Підтримувані операції в батчі: `rewrite`, `merge-into`, `delete`
- Після кожного батчу виконувався `git add docs/adr/ && git commit` перед стартом наступного — щоб ізолювати зміни і мати можливість відкату по одному батчу
