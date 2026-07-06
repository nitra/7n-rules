---
type: JS Module
title: compress-context.mjs
resource: llm-lib/lib/internal/compress-context.mjs
docgen:
  crc: 61b94b7d
---

## Огляд

Стиснення pi-контексту (messages + systemPrompt) перед префілом — клієнтський еквівалент колишньої проксі-компресії myllm (compress.rs), адаптований під форму pi Context (messages завжди array-parts, system живе окремо в systemPrompt, tool-виклик — role toolResult / part type toolCall — не 1:1 порт, а перевідображення тієї самої техніки, підтверджено спайком 2026-07-06). INTERNAL — приймає/повертає pi Context.

## Поведінка

compressContext — мінізує вбудований pretty-printed JSON у текстових частинах messages і systemPrompt; обрізає (truncate-middle) старі непротектовані блоки довші за поріг; захищає останні PROTECTED_TAIL_MESSAGES messages від truncation (лише minify); systemPrompt захищений від truncation, доки сумарний розмір контексту не перевищить SYSTEM_TRUNCATION_SIZE_THRESHOLD; повідомлення з tool-викликом (toolCall part / role toolResult) лишаються byte-exact.

## Публічний API

compressContext(context) — стиснений контекст (новий обʼєкт) або той самий, якщо нічого не змінилось.

## Гарантії поведінки

- Ніколи не змінює tool-payload (toolCall/toolResult) byte-exact.
- Не втрачає дані: тільки minify (без семантичних змін) + truncate-middle з явним маркером.
- Pure-функція, без side-effects і без залежності від pi SDK.
