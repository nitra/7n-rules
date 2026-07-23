---
type: JS Module
title: fix-hooks.mjs
resource: plugins/lang-python/coverage-provider/fix-hooks.mjs
docgen:
  crc: b91da019
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Функції для Python coverage і mutation ladder-а запускають агентні сесії `runAgentFix` з `@7n/llm-lib/agent-fix`: `generatePythonTests` догенеровує pytest-тести для Python-файлів нижче порогу покриття, а `fixPythonSurvived` створює тести, що вбивають survived-мутанти `mutmut`.

Файл зберігає той самий ladder-контракт, що й JS/Rust-хуки: `ctx.timeoutMs` передається в агентну сесію, власних retry-циклів немає, а convergence веде ladder-ядро.

`@7n/llm-lib` підключається динамічно, бо це dependency ядра `@7n/rules`, а не Python-плагіна.

## Поведінка

generatePythonTests і fixPythonSurvived приймають дані від coverage/mutation ladder-а, залишають у роботі лише Python-цілі й за відсутності релевантних файлів завершуються без змін.

Для релевантних цілей вони формують інструкцію для агентної fix-сесії через buildGenTestsPrompt або buildFixSurvivedPrompt. Перша інструкція спрямовує агента на догенерацію pytest-тестів для файлів нижче порогу покриття, друга — на тести, що відрізняють оригінальну поведінку від survived-мутантів.

Обидва потоки передають агенту корінь проєкту, список цільових файлів і ladder-контекст. Контекст використовується як спільний контракт виконання: timeout і feedback прокидаються в агентну сесію, а вибір моделі може надходити з контексту або з хмарних fallback-рівнів.

Результатом generatePythonTests і fixPythonSurvived є список файлів, яких фактично торкнулась агентна сесія. Власних записів у файлову систему цей модуль не виконує. Власних retry-циклів немає: повтори й конвергенцію контролює ladder ядра.

## Публічний API

- buildGenTestsPrompt — Промпт догенерації pytest-тестів для файлів нижче порогу покриття.
- buildFixSurvivedPrompt — Промпт написання тестів, що вбивають survived-мутанти mutmut.
- generatePythonTests — Догенерація pytest-тестів для файлів нижче порогу.
- fixPythonSurvived — Тести проти survived-мутантів mutmut.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
