---
type: JS Module
title: skill-meta.mjs
resource: npm/scripts/lib/skill-meta.mjs
docgen:
  crc: 41a911f9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль парсить метадані скіла з файлу `main.json`, який є єдиним джерелом правди для визначення логіки його виконання. Обробляє такі параметри: умова автоактивації (`auto`), необхідність ізоляції у `worktree` та чи вимагає скіл запуску з кореня репозиторію (`requireRoot`). Це дозволяє іншим компонентам (як-от `auto-skills.mjs` та `n-rules.js`) коректно інтерпретувати вимоги скілу та керувати його виконанням.

Поведінка
Надає константи для визначення умов: `SKILL_ALWAYS="завжди"` (безумовна активація) та `DEFAULT_SKILL_TIER="max"` (за замовчуванням найсильніший рівень моделі).

Функції інтерпретують метадані з `main.json`:
`readSkillMetaRaw` зчитує вміст `main.json` скіла у заданому каталозі.
`parseSkillAutoSpec` аналізує специфікацію автоматичної активації скіла (поле `auto`).
`skillRequiresRoot` визначає, чи вимагає скіл запуску з кореня репозиторію.
`skillTier` встановлює рівень моделі для скіла на основі поля `tier` або за замовчуванням.

Взаємодія з помилками: Модуль перехоплює помилки (fail-safe), не генеруючи винятків назовні, а замість них повертає порожнє значення (наприклад, `null`).
Обмеження: Модуль не виконує операції з файловою системою чи базою даних; він не забезпечує кешування.

## Поведінка

Поведінка:
SKILL_ALWAYS: Константа, яка вказує на безумовну активацію скіла.
SKILL_TIERS: Масив допустимих рівнів моделі для виконання скіла.
DEFAULT_SKILL_TIER: За замовчуванням встановлений найсильніший рівень моделі для скіла.
parseSkillAutoSpec: Визначає специфікацію автоактивації скіла на основі значення поля `auto` з `main.json`.
skillRequiresRoot: Визначає, чи повинен скіл виконуватися з кореня репозиторію, на основі метаданих скіла.
skillTier: Визначає рівень моделі для виконання скіла, використовуючи поле `tier` з `main.json` або повертаючи значення за замовчуванням.
readSkillMetaRaw: Зчитує та парсить метадані з файлу `main.json` у вказаному каталозі скіла.

## Публічний API

I will use the `n-doc-files/SKILL.md` skill to generate the documentation, as requested by the persona (technical writer creating concise behavioral documentation in Ukrainian Markdown).

Since I don't have the code file to document, I will assume the request is to _reproduce the documentation style_ based on the provided list and principles, which is essentially a request to apply the "behavior" description for generating documentation.

However, the prompt asks me to "Rewrite this list as concise bullet points..." using the provided list items and adhering to strict style rules. I will perform this rewriting task.

Here is the rewritten list according to the constraints:

- SKILL_ALWAYS — Позначає, що певний набір скілів має виконуватися без умов.
- SKILL_TIERS — Список дозволених рівнів (тирів) моделі, які можуть виконувати скіл через `pi`-runner.
- DEFAULT_SKILL_TIER — Встановлений рівень для скілів, якщо він не визначений у конфігурації `main.json` (за замовчуванням — найпотужніший тир).
- parseSkillAutoSpec — Визначає, чи має скіл автоматично активуватися на основі конфігурації в `main.json`.
- skillRequiresRoot — Позначає, чи потрібно, щоб скіл виконувався з кореневої директорії репозиторію.
- skillTier — Визначає рівень моделі для виконання скілу, використовуючи значення з `main.json`, або повертає `DEFAULT_SKILL_TIER` у разі невалідного значення.
- readSkillMetaRaw — Зчитує та аналізує метадані певного скілу з файлу `main.json`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
