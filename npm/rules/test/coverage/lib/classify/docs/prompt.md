---
type: JS Module
title: prompt.mjs
resource: npm/src/coverage-classify/prompt.mjs
docgen:
  crc: b4dd4c52
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Промпт-builder для `coverage-classify` генерує контекстні інструкції. Він визначає статичну роль класифікатора (`SYSTEM_PROMPT`), яка кешується через `cache_control: ephemeral` при виклику API. Динамічно він збирає деталі кожного мутанта (location, source $\pm$10, tests, git) у промпт, що здійснюється функцією `buildUserPrompt`. Процес працює з механізмом fail-safe, запобігаючи виникненню винятків, а кешування відбувається в межах одного прогону. `SYSTEM_PROMPT` явно вимагає строго валідний JSON без markdown-fence і prose навколо нього, з інструкцією екранувати лапки/backslash усередині `reason`/`suggestedTest` і триматись у межах довжини — це знижує частку відповідей, які не парсяться як JSON.

## Поведінка

SYSTEM_PROMPT визначає роль класифікатора мутацій і встановлює чіткий JSON-схему для відповіді, де мутації класифікуються як 'worth-testing', 'equivalent', 'defensive', 'glue' або 'wrapper'.
buildUserPrompt збирає повний контекст для класифікації конкретного мутанта, включаючи фрагмент вихідного коду навколо місця мутації, вміст супутніх тестів та останні зміни у Git для створення деталізованого промпта.

## Публічний API

SYSTEM_PROMPT — Визначає основні інструкції та обмеження для AI-агента.
buildUserPrompt — Формує запит від користувача для розпізнавання конкретного мутагенту.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Кешує результати в межах одного прогону.
