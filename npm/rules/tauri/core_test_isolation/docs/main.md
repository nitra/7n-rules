---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/core_test_isolation/main.mjs
docgen:
  crc: 9d56f463
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 95
  issues: anchor-miss:(core_test_isolation.mdc),judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Read-only lint `core_test_isolation.mdc` для Tauri-монорепо виявляє, чи LLM agent/provider-логіка винесена з `src-tauri` в окремий workspace-крейт без залежності на `tauri`. Файл існує, щоб через `lint` репортувати архітектурні порушення `LLM_DEP_IN_APP_SHELL`, `CORE_CRATE_DEPENDS_ON_TAURI` і `MISSING_FAKE_LLM_PROVIDER`, які заважають ізольовано запускати `cargo test -p <crate>` без повної збірки застосунку, і не намагається виправляти їх автоматично.

## Поведінка

`lint` read-only проходить Tauri-проєкти в монорепо, знаходить каталоги `src-tauri/` з власним Cargo-маніфестом і перевіряє межу між app-shell та core agent/provider-логікою для LLM. Дані беруться з файлової структури й Cargo-маніфестів, а результатом є lint-звіт без змін у файлах.

Перевірка спочатку визначає залежності app-shell крейту: якщо LLM-залежність підключена напряму в `src-tauri`, репортується `LLM_DEP_IN_APP_SHELL="llm-dep-in-app-shell"` — ознака того, що LLM-логіка не винесена з Tauri-шару. Далі для окремого workspace-крейту з LLM-залежністю перевіряється, що він не залежить від `tauri`; порушення позначається як `CORE_CRATE_DEPENDS_ON_TAURI="core-crate-depends-on-tauri"`, бо такий зв’язок ускладнює ізольований `cargo test` без повної збірки застосунку. Окремо очікується fake/mock/stub LLM-провайдер для тестів; його відсутність репортується як `MISSING_FAKE_LLM_PROVIDER="missing-fake-llm-provider"`.

Повідомлення прив’язані до правила ``. Перевірка не виконує автофікс, бо безпечно винести крейт, перенести код і налаштувати тестову підміну неможливо механічно без ризику зламати архітектуру.

## Публічний API

- LLM_DEP_IN_APP_SHELL — Стабільний reason: LLM-залежність оголошена в app shell замість core-крейта.
- CORE_CRATE_DEPENDS_ON_TAURI — Стабільний reason: core-крейт залежить від Tauri — ламає ізоляцію unit-тестів від runtime.
- MISSING_FAKE_LLM_PROVIDER — Стабільний reason: у тестах core-крейта немає fake-провайдера LLM для роботи без мережі.
- `lint` — виявляє порушення ізоляції core-тестів між LLM, Tauri та fake provider для тестового середовища.

Експортовані константи-рядки: `LLM_DEP_IN_APP_SHELL="llm-dep-in-app-shell"` — порушення, коли app shell напряму залежить від LLM; `CORE_CRATE_DEPENDS_ON_TAURI="core-crate-depends-on-tauri"` — порушення, коли core crate прив’язується до Tauri; `MISSING_FAKE_LLM_PROVIDER="missing-fake-llm-provider"` — порушення, коли для тестів немає fake LLM provider.

Поведінка: повідомлення позначаються маркером ``, щоб швидко пов’язати діагностику з правилом ізоляції тестів.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
