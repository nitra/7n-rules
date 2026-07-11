---
type: JS Module
title: body-capture.mjs
resource: llm-lib/lib/body-capture.mjs
docgen:
  crc: 3e3be25e
---

## Огляд

Захоплення повних тіл LLM-викликів (prompt+response) — заміна колишнього requests.jsonl myllm-проксі, з перевагою: працює і для CLOUD-викликів (проксі бачив лише local), і не залежить від запущеного myllm. Увімкнено за замовчуванням — вимикається N_LLM_TRACE_BODIES=0. Не pi-coupled — публічний модуль пакета.

## Поведінка

captureBody — пише JSON-файл у ~/.n-cursor/llm-bodies/<chainId або caller>/<step>.json (ts, caller, chainId, chainStep, model, promptHash, prompt, output, usage, error); best-effort, ніколи не кидає; no-op (повертає null) коли body-capture вимкнено. При записі перевіряє сумарний розмір стору і видаляє найстаріші файли понад N_LLM_BODIES_MAX_MB (дефолт 500).

## Публічний API

bodiesDir() — корінь стору (env N_LLM_BODIES_DIR).
bodyCaptureEnabled() — чи увімкнено (N_LLM_TRACE_BODIES!=='0').
captureBody(record, opts?) — шлях збереженого файлу або null.

## Гарантії поведінки

- Best-effort: жодна файлова помилка не валить виклик LLM.
- Ретеншн: сумарний розмір стору не росте необмежено (авто-очистка найстаріших файлів).
- Компоненти шляху (chainId/caller/step) санітизуються — без directory traversal.
