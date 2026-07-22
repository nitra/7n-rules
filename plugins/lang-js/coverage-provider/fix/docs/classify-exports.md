---
type: JS Module
title: classify-exports.mjs
resource: plugins/lang-js/coverage-provider/fix/classify-exports.mjs
docgen:
  crc: af4ad450
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл визначає named exports у JS/MJS-джерелі та класифікує кожен за складністю генерації тестів. `extractExportsWithComplexity` використовується для маршрутизації: тривіальні й прості exports спрямовуються до local LLM, складні — до cloud LLM.

## Поведінка

`extractExportsWithComplexity` приймає текст JS/MJS-файлу як єдине джерело даних, знаходить у ньому named exports і повертає список результатів для подальшого вибору моделі генерації тестів.

Для кожного знайденого експорту застосовується спільна шкала складності: примітивні константи позначаються як `trivial`, звичайний код без ризикових ознак — як `simple`, а код із ризиковими ознаками — як `complex`. Такі `complex`-результати призначені для маршрутизації до cloud LLM, решта — до local LLM.

Результат класифікації існує тільки у поверненій структурі й залежить від поточного вмісту переданого джерела.

## Публічний API

- extractExportsWithComplexity — Extracts all named exports and classifies each by test complexity.

## Гарантії поведінки

- Класифікація повертає дані про знайдені named exports і їхню складність.
