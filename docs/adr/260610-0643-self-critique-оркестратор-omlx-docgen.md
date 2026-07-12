---
type: ADR
title: Self-critique оркестратор для omlx docgen
description: Для покращення Tier 1 docgen через локальний omlx обрано цикл generate → critique → refine → score з тестовим прогоном на 5 файлів.
---

**Status:** Accepted
**Date:** 2026-06-10

## Context and Problem Statement

Після pilot-прогону Tier 1 docgen через `omlx` якість стала кращою за попередній `pi + ollama` підхід, але transcript фіксує повторювану проблему з generic-фразами, зокрема у секції «Гарантії». Потрібен оркестратор, який покращує якість локальної генерації через кілька запусків на один файл без переходу в cloud.

## Considered Options

- A: self-critique loop — `generate → score → critique → regenerate/refine → score`.
- B: section-by-section parallel + merge.
- C: tournament sampling — `generate×3 → score all → pick max-score`.
- D: knowledge injection → generate → validate.

## Decision Outcome

Chosen option: "A: self-critique loop з тестовим прогоном на 5 файлів", because transcript рекомендує цей варіант як найкращий для якості: модель читає власний текст з окремої позиції критика, а зміни архітектури мінімальні — додати critique/refine крок і цикл навколо наявної генерації.

### Consequences

- Good, because transcript очікує кращу якість завдяки окремому critique-кроку, який має виявляти generic-формулювання перед refine.
- Good, because рішення лишається local-only і не потребує cloud escalation для Tier 1 docgen.
- Bad, because transcript оцінює час приблизно у `~100s/файл` для `max_iter=2`, тобто близько 5 годин для 175 файлів.
- Bad, because critique-запит теж може бути generic, якщо локальна модель системно не бачить потрібного змісту.
- Neutral, because transcript завершується до реалізації; підтверджених результатів тестового прогону на 5 файлів не зафіксовано.

## More Information

Планований тестовий режим: прогнати 5 файлів і після кожного показувати `git diff`.

Варіанти з transcript:

- A: self-critique loop — найкраща якість, приблизно `3 × 50s` для повного `generate → critique → refine`, або `~100s/файл` при `max_iter=2`.
- B: section-by-section parallel + merge — швидше тільки за наявності справжнього parallel execution; без worker буде sequential.
- C: tournament sampling — простий best-of-N, але не гарантує виправлення системних generic-помилок.
- D: knowledge injection — дешевший, але ризикує generic extraction на першому кроці.

Точка розширення з transcript: `critiqueOmlx` / refine-крок у docgen generator. Остаточні назви функцій transcript не підтверджує.
