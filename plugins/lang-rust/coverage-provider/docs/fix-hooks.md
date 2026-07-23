---
type: JS Module
title: fix-hooks.mjs
resource: plugins/lang-rust/coverage-provider/fix-hooks.mjs
docgen:
  crc: 993aebed
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Публічні функції `buildGenTestsPrompt`, `buildFixSurvivedPrompt`, `generateRustTests` і `fixRustSurvived` задають дві агентні fix-сесії для Rust coverage: генерацію `#[cfg(test)]`-тестів для файлів нижче порогу покриття через `generateTests` і добір тестів, що вбивають survived-мутанти cargo-mutants через `fixSurvived`. Обидва шляхи працюють через спільний ladder-контракт `@7n/llm-lib/agent-fix`, де `ctx.recordWrite` проходить через write-guard агента, `ctx.timeoutMs` прокидається сесії, а конвергенцію забезпечують повторні rung-и ядра без власних retry-циклів. `@7n/llm-lib` — dependency ядра `@7n/rules`, не плагіна: динамічні import-и — канонічний патерн fix-worker-ів.

## Поведінка

buildGenTestsPrompt і buildFixSurvivedPrompt формують текст завдання для агентної fix-сесії: перший збирає перелік Rust-файлів, що не добрали поріг line coverage, другий — групи survived-мутантів cargo-mutants по файлах і рядках. Обидва тексти задають однаковий контракт поведінки для наступного кроку: працювати лише з test-кодом у `#[cfg(test)]`, не чіпати production-код і підтвердити зелений `cargo test`.

generateRustTests і fixRustSurvived запускають спільний агентний шлях виконання через runAgentFix з однаковими ladder-правилами для записів і таймауту. Дані для них надходять як Rust-цілі, а далі ті самі цілі передаються в write-guard як перелік target files, результатом стає список фактично змінених файлів. Якщо вхід не містить Rust-цілей, обидва шляхи завершуються без дій і повертають порожній результат.

Обидва робочі потоки не ведуть власного retry-циклу: конвергенцію забезпечує ladder ядра через повторні rung-и. За помилки сесії може бути повернуто порожній або частковий перелік touchedFiles, а повідомлення про збій лишається в консолі.

## Публічний API

- buildGenTestsPrompt — Промпт догенерації unit-тестів для Rust-файлів нижче порогу покриття.
- buildFixSurvivedPrompt — Промпт написання тестів, що вбивають survived-мутанти cargo-mutants.
- generateRustTests — Догенерація Rust-тестів для файлів нижче порогу (hook `generateTests`).
- fixRustSurvived — Тести проти survived-мутантів cargo-mutants (hook `fixSurvived`).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
