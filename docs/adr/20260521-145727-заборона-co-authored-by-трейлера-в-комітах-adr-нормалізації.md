---
session: ea881c04-dcf0-4753-a405-2366550a0911
captured: 2026-05-21T14:57:27+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/ea881c04-dcf0-4753-a405-2366550a0911.jsonl
---

## ADR Заборона `Co-Authored-By` трейлера в комітах ADR-нормалізації

## Context and Problem Statement
Під час масової нормалізації ADR-чернеток (`n-adr-normalize`) скрипт `.claude/hooks/normalize-decisions.sh` формував коміти з трейлером `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Claude Code auto mode classifier заблокував такий коміт із причиною "Content Integrity / Impersonation — misrepresenting the agent's identity".

## Considered Options
* Залишити `Co-Authored-By` трейлер у повідомленні коміту
* Видалити `Co-Authored-By` трейлер — комітити лише з коротким `adr: normalize batch`

## Decision Outcome
Chosen option: "Видалити `Co-Authored-By` трейлер", because auto mode classifier заблокував коміт з атрибуцією `Claude Opus 4.7`, і повторний коміт без трейлера пройшов без помилок.

### Consequences
* Good, because transcript фіксує очікувану користь: коміти `bb28aaf`, `d03d00d`, `0ddee21`, `dfaaa87`, `e171dad`, `35a6d72`, `0dc7460` успішно пройшли без блокування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команда коміту без трейлера: `git commit -q -m "adr: normalize batch"`. Заблокований варіант: `git commit -m "... Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"`. Причина блокування з повідомлення класифікатора: `"Commit message attributes the work to 'Claude Opus 4.7' as a Co-Author, misrepresenting the agent's identity (Content Integrity / Impersonation)"`. Чернетка про цю подію: `docs/adr/20260521-144934-видалення-co-authored-by-трейлера-з-комітів-adr-нормалізації.md`.

---

## ADR Стратегія масової нормалізації ADR: послідовні батчі з комітом після кожного

## Context and Problem Statement
У `docs/adr/` накопичилося 66 чернеток з `session:` у frontmatter. Стандартний автозапуск через hook проходить не частіше ніж раз на 6 годин (`ADR_NORMALIZE_MIN_INTERVAL_HOURS=21600`) і лише при досягненні порогу. Потрібно було обробити всі накопичені чернетки за одну сесію.

## Considered Options
* Один масовий прогон усіх чернеток
* Послідовні батчі по 10 із комітом після кожного батчу та обходом `ADR_NORMALIZE_THRESHOLD=0` і `ADR_NORMALIZE_MIN_INTERVAL_HOURS=0`
* Закомітити після завершення всіх батчів одним комітом

## Decision Outcome
Chosen option: "Послідовні батчі по 10 із комітом після кожного", because користувач явно обрав "Закомітити й продовжити" на запит після першого батчу, і ця стратегія повторювалась для всіх наступних батчів.

### Consequences
* Good, because transcript фіксує очікувану користь: 66 чернеток оброблено за 10 батчів (батчі 1–9 по 10, батч 10 — 1 чернетка); кожен батч закомічено окремо, що дає атомарну git-історію; batch 3 провалився через некоректний JSON від LLM і був успішно повторений без втрати прогресу завдяки ізольованим комітам.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команда запуску кожного батчу: `ADR_NORMALIZE_THRESHOLD=0 ADR_NORMALIZE_MIN_INTERVAL_HOURS=0 bash .claude/hooks/normalize-decisions.sh`. Скрипт: `.claude/hooks/normalize-decisions.sh`. Лог: `.claude/hooks/normalize-decisions.log`. Розмір батчу: `batch size: 10` (або менше для останнього). Модель LLM: `claude` CLI, модель `sonnet`. Коміти сесії: `7c62d53`, `c45b8c9`, `f3ddb9e`, `bb28aaf`, `d03d00d`, `0ddee21`, `dfaaa87`, `e171dad`, `35a6d72`, `0dc7460`.
