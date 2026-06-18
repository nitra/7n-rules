---
type: ADR
title: ""
---

## ADR Pi конкатенує system+user roles у plain-text без семантичної передачі в Ollama

## Context and Problem Statement
При реалізації docgen-tier-1 використовувалося два підходи до виклику Ollama: через Pi CLI і через прямий HTTP запит до `/api/chat`. В попередніх бенчмарках Pi давав 78–87% якості, прямий Ollama з `system`-role — стабільні 85%. Виникло питання: чи Pi внутрішньо конструює `role: "system"` message, чи є якийсь інший механізм переваги через Pi?

## Considered Options
* Pi як text-proxy: конкатенує `systemContent + '\n\n' + userContent` і передає Ollama як один user-message
* Pi як smart transport: розпізнає структуру і реконструює `[{role:"system",...},{role:"user",...}]` перед `/api/chat`

## Decision Outcome
Chosen option: "Pi як text-proxy", because читання `npm/skills/docgen/js/docgen-gen.mjs` рядки 27–40 показує: код сам конкатенує roles перед викликом Pi (`[systemContent, userContent].filter(Boolean).join('\n\n')`), Pi отримує `--mode text` з одним рядком і передає його Ollama без розбору структури.

### Consequences
* Good, because це пояснює, чому різниця між Pi і прямим Ollama з system-role становить лише 1–2 п.п. (шум): фактично обидва шляхи передають model той самий текст.
* Bad, because transcript не містить підтверджених негативних наслідків; потенційний ризик — Pi може мати власний system-wrapper за замовчуванням, що не перевірялося.

## More Information
Ключовий код: `npm/skills/docgen/js/docgen-gen.mjs`, функції `piOneShot` і `piOrchestrated` (рядки 24–43).
Промпт-структура: `npm/skills/docgen/js/docgen-prompts.mjs`, функція `sectionMessages` — повертає `messages: [{role:'system',...},{role:'user',...}]`, але роль ігнорується при виклику Pi.
Прямий транспорт (рекомендований): `fetch(OLLAMA_HOST + "/api/chat", { body: { messages: [{role:"system", content: systemContent}, {role:"user", content: userContent}] } })`.
Пов'язані ADR: `20260608-1144-docgen-transport-order-mismatch.md` (інверсія порядку транспортів у llm.mjs).
Виміри з бенчмарку (memory): прямий без system = 71%, Pi = 78–87%, прямий з explicit system-role = 85% стабільно.
