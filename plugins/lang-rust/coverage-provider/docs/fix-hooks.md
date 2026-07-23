---
type: JS Module
title: fix-hooks.mjs
resource: plugins/lang-rust/coverage-provider/fix-hooks.mjs
docgen:
  crc: ed03c517
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл задає опційні fix-сесії для Rust coverage-шляху: `generateTests` добирає `#[cfg(test)] mod tests` для файлів нижче порогу покриття, а `fixSurvived` — тести, що мають убивати survived-мутанти `cargo-mutants`. Публічні входи `buildGenTestsPrompt`, `buildFixSurvivedPrompt`, `generateRustTests`, `fixRustSurvived` працюють через спільний `runAgentFix` у `@7n/llm-lib/agent-fix`, який є dependency ядра `@7n/rules`, а не плагіна. Контракт запису той самий, що в JS-хуків: `ctx.recordWrite` проходить через write-guard агента, `ctx.timeoutMs` прокидається сесії, а конвергенцію забезпечує ladder ядра повторними rung-ами без власних retry-циклів.

## Поведінка

buildGenTestsPrompt і buildFixSurvivedPrompt формують окремі агентні промпти для двох coverage-шляхів: перший для дозаповнення `#[cfg(test)] mod tests` у Rust-файлах нижче порогу покриття, другий — для тестів, що мають зупиняти survived-мутанти cargo-mutants. Обидва тексти збирають лише контекст проблемних файлів і жорстко задають межі роботи: змінювати треба тільки тести, а перевірка результату очікується через `cargo test`.

generateRustTests і fixRustSurvived є вхідними воротами для відповідних hook-ів. Вони відсікають не-Rust цілі, щоб не запускати агентну сесію без потреби, далі передають зібраний промпт, корінь проєкту, ladder-стан і список цільових файлів у спільний запуск через runAgentFix. Результат повертається як фактично змінені файли; помилка сесії не ламає потік, а лише фіксується в логах і завершується порожнім набором змін.

Спільний для обох шляхів контракт — покладатися на ladder ядра для повторних спроб і конвергенції, а також прокидати write-guard, timeout і feedback без власної retry-логіки в цьому файлі. Дані сюди приходять уже як добірка файлів або survived-груп, а виходять як список touchedFiles для подальших кроків пайплайна.

## Публічний API

- buildGenTestsPrompt — Промпт догенерації unit-тестів для Rust-файлів нижче порогу покриття.
- buildFixSurvivedPrompt — Промпт написання тестів, що вбивають survived-мутанти cargo-mutants.
- generateRustTests — Догенерація Rust-тестів для файлів нижче порогу (hook `generateTests`).
- fixRustSurvived — Тести проти survived-мутантів cargo-mutants (hook `fixSurvived`).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
