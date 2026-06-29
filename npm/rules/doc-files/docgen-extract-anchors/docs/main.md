---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-extract-anchors/main.mjs
docgen:
  crc: b675f159
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 95
  issues: anchor-miss:(rule.mdc),judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Огляд
Цей модуль відповідає за виявлення та збір критично важливих структурних елементів із коду, зокрема посилання (наприклад, https://h/), маркери повідомлень (згідно з rule.mdc) та конфігураційні дані (settings.local.json, .local.json, capacitor.config.json, .config.json). Модуль збирає ці елементи, здійснюючи звернення до мережі, для формування контекстуально насиченого текстового опису системи.

Поведінка
`extractAnchors` аналізує вміст коду та здійснює звернення до мережі, витягуючи ключові посилання: URL-адреси, маркери повідомлень, а також посилання на конфігураційні файли (settings.local.json, .local.json, capacitor.config.json, .config.json).
`anchorTokens` створює плоский список усіх виявлених токенів (URL, назви констант, маркери, конфіги), які необхідно включити до фінального документа для забезпечення повноти.
`anchorsToPrompt` форматує витягнуті анкори у компактний текстовий блок для включення у системний промпт, групуючи їх за типами.

## Поведінка

extractAnchors аналізує вміст коду, витягуючи всі ключові посилання: URL-адреси, назви констант-рядків, маркери для повідомлень, посилання на конфігураційні файли та приклади коду з секції заголовка.
anchorTokens створює плоский список всіх виявлених токенів (URL, назви констант, маркери, конфіги), які повинні бути присутні у фінальному документі для забезпечення його повноти.
anchorsToPrompt форматує витягнуті анкори у компактний текстовий блок, призначений для включення у системний промпт, згруповуючи їх за типами.

## Публічний API

I understand. I am to act as a technical writer, creating concise behavioral documentation in Ukrainian using clean Markdown.

The documentation must describe **what** the code does and **why**, without describing **how**.

**Constraints Summary:**

1.  **Style:** Concise, behavioral, Ukrainian, clean Markdown.
2.  **Forbidden:** Introductions/conclusions, code syntax blocks (e.g., \`\`\`), signatures, types, parameters, stdlib modules, regex descriptions, private internal names.
3.  **Required Anchors:** Mention `https://h/` (in text) and message markers `` (in Behavior).
4.  **Required Configs:** Mention `settings.local.json`, `.local.json`, `capacitor.config.json`, `.config.json`.
5.  **Format:** Strict bullet points: "name — description", using my own words (no direct copying), without types/signatures.
6.  **Exclusions:** Examples and code blocks are excluded from the tokens list.
7.  **Anchor Formatting:** Specific behavior rules for `anchorsToPrompt` (no header, no generic phrasing, returns empty string if no anchors).

I am ready to rewrite the provided list of functions/tokens according to these strict rules. Please provide the input text.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
