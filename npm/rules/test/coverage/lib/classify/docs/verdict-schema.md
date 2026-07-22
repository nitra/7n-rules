---
type: JS Module
title: verdict-schema.mjs
resource: npm/src/coverage-classify/verdict-schema.mjs
docgen:
  crc: 51190b81
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей файл визначає `VerdictSchema` для структурованого відображення результатів класифікації, які генерує LLM-класифікатор (coverage-classify). Функція `parseVerdict` відповідає за вилучення та валідацію JSON-структури з необробленого тексту відповіді LLM, що дозволяє класифікувати вихід у категорії: `worth-testing`, `equivalent`, `defensive`, `glue` або `wrapper`. Витяг JSON толерантний до типових LLM-огріхів (markdown fences, prose навколо JSON, неекрановані лапки/backslash/control-символи всередині string-значень), які на практиці регулярно ламали наївний `JSON.parse`.

## Поведінка

VerdictSchema: Визначає структуру даних для результатів класифікації, отриманих від LLM.
parseVerdict: Знаходить перший JSON-об'єкт у сирому тексті відповіді (розрізаючи markdown-fence, якщо він є), ремонтує типові огріхи всередині string-значень (неекрановані лапки, невалідні backslash-escape як `\d`, буквальні control-символи, trailing comma), обрізає candidate по balanced-brace межі першого `{…}` (ігноруючи prose після нього), а надто довгі `reason`/`suggestedTest` — обрізає до ліміту схеми замість falling через `too_big`-помилку валідації. Лише після цього валідує через `VerdictSchema`.

## Публічний API

VerdictSchema — схема, що описує очікувану структуру відповіді від LLM.
parseVerdict — видобуває та перевіряє відповідь від LLM щодо відповідності схемі VerdictSchema; кидає помилку, якщо JSON не знайдено, JSON не парситься навіть після repair, або результат не проходить схему.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Repair-крок ніколи не звертається до мережі чи файлової системи — чиста трансформація рядка.
