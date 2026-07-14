---
type: ADR
title: Семантика N_CURSOR_OMLX_URL як повного endpoint URL
description: `N_CURSOR_OMLX_URL` має містити повний URL endpoint, бо `callOmlxRaw` використовує значення змінної без дописування `/chat/completions`.
---

**Status:** Accepted
**Date:** 2026-06-12

## Context and Problem Statement

Під час запуску `doc-files gen` із `N_CURSOR_OMLX_URL=http://localhost:8000/v1` виклики до omlx повертали `omlx empty content (finish=null)`. За замовчуванням `DEFAULT_OMLX_URL` уже містить повний шлях `http://127.0.0.1:8000/v1/chat/completions`, але env-змінна підставляється як готовий URL запиту.

## Considered Options

- `N_CURSOR_OMLX_URL` містить повний URL endpoint, включно з `/chat/completions`.
- Не встановлювати `N_CURSOR_OMLX_URL`, якщо omlx слухає на дефолтному endpoint.

## Decision Outcome

Chosen option: "`N_CURSOR_OMLX_URL` містить повний URL endpoint, включно з `/chat/completions`", because `callOmlxRaw` у `npm/lib/omlx.mjs` підставляє env-значення напряму як URL запиту без конкатенації шляху.

### Consequences

- Good, because transcript фіксує: після видалення неправильного env override генерація трьох Rust-файлів завершилася без помилок.
- Good, because правило робить конфігурацію явною: або не задавати змінну й використовувати дефолт, або передати повний endpoint.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because інші Rust-зміни з цього transcript належать до окремого ADR про підтримку Rust у `doc-files`.

## More Information

Файл: `npm/lib/omlx.mjs`.

Зафіксована семантика:

- дефолт: `http://127.0.0.1:8000/v1/chat/completions`;
- коректний override: `N_CURSOR_OMLX_URL=http://localhost:8000/v1/chat/completions`;
- некоректний override із transcript: `N_CURSOR_OMLX_URL=http://localhost:8000/v1`.

Якщо передати лише базовий `/v1` URL, запит іде на хибний endpoint і omlx повертає порожню відповідь із `finish_reason: null`.
