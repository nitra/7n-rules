---
type: ADR
title: "Підтримка двох форматів JSONL у capture-decisions.sh"
---

# Підтримка двох форматів JSONL у capture-decisions.sh

**Status:** Accepted
**Date:** 2026-05-20

## Context and Problem Statement

Хук `capture-decisions.sh` фільтрував рядки transcript через `select(.type == "user" or .type == "assistant")` — формат Claude Code. Cursor Agent записує transcript з полем `.role` замість `.type`, тому для Cursor-сесій `jq` давав 0 байт тексту, скрипт виходив мовчки, LLM не викликався і жоден ADR-файл не створювався.

## Considered Options

- Оновити `jq`-фільтр: підтримати обидва поля — `.type` (Claude Code) і `.role` (Cursor Agent)
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Оновити `jq`-фільтр для підтримки `.type` і `.role`", because виправлення одного `select()`-виразу охоплює обидва рантайми без жодної додаткової інфраструктури; після правки Cursor-сесія `5b23f892-…` успішно створила draft `docs/adr/20260520-085803-….md`.

### Consequences

- Good, because Cursor-сесії тепер генерують ADR-draft так само, як Claude Code-сесії.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінені файли: `.claude/hooks/capture-decisions.sh`, `npm/.claude-template/hooks/capture-decisions.sh`
- Доданий діагностичний лог: `→ empty transcript after jq (Claude Code: .type; Cursor Agent: .role)` при порожньому результаті jq
- Формати: `{"type":"user","message":{…}}` (Claude Code) vs `{"role":"user","message":{…}}` (Cursor Agent)

## Update 2026-05-20

### Дедуплікація ADR-чернеток за ідентифікатором сесії

Після виправлення парсера Cursor-transcript один stop-хук може дати два `fired`-рядки для однієї `conversation_id` (зафіксовано о 08:50 і 08:52), що потенційно створює два однакових draft у `docs/adr/` і подвоює LLM-витрати.

**Considered Options:**

- Variant 1: перед записом перевіряти `docs/adr/*` на `session: <id>` у frontmatter — пропускати з логом `skip: session already captured`
- Variant 2: lock-файл `.claude/hooks/.capture-<session>` на час LLM-виклику
- Variant 3: нічого не робити — `normalize` зведе дублі через `merge-into`

**Chosen option:** "Variant 1 — перевірка `session:` у frontmatter", because мінімальний підхід без зовнішнього стану: один grep по `docs/adr/` і вихід без потреби прибирати stale lock-файли. Variant 2 відхилений через stale lock; Variant 3 — через зайвий LLM-шум.

- Good, because менше дублікатів у `docs/adr/` і менше зайвих LLM-викликів на подвійний stop.
- Bad, because якщо в одній сесії справді два різних ADR — другий draft не збережеться; обхід — ручний виклик capture.
- Neutral, because рішення обговорювалося, але реалізацію в transcript не зафіксовано — це запланований наступний крок.

Задіяні файли: `.claude/hooks/capture-decisions.sh`, `docs/adr/*.md` (frontmatter поле `session:`).
