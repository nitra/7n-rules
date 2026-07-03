---
type: JS Module
title: fix-stryker_config.mjs
resource: npm/rules/test/stryker_config/fix-stryker_config.mjs
docgen:
  crc: ecff0dc4
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 90
  issues: internal-name:planStrykerActions,judge:inaccurate:0.95
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл виконує T0-autofix для `test/stryker_config`: детерміновано створює canonical baseline-и Stryker/Vitest, створює `vue-plugin`-файл, доповнює наявний Vue config і дозаписує тестові патерни в `.gitignore`. Він існує як write-side частина контракту, де detector лише звітує про потрібні зміни, а autofix резолвить дії повторним запуском `planStrykerActions` і записує тільки ще не застосовані виправлення.

Файл підтримує unified lint surface через structured violations: `test` перевіряє наявність порушень, а `apply` застосовує відповідні виправлення. Публічний API надає `patterns`. Шлях `.git` свідомо пропускається.

## Поведінка

1. `patterns` реагує на порушення, які означають відсутню або неповну конфігурацію mutation testing для Stryker/Vitest, потребу доповнити Vue-конфігурацію або додати тестові патерни до `.gitignore`.

2. `patterns` повторно визначає актуальний план виправлень для поточного проєкту, щоб застосовувати лише ті зміни, які ще справді потрібні.

3. Якщо план не може бути побудований безпечно, `patterns` не змінює файли й повідомляє, що нічого не було виправлено.

4. `patterns` створює canonical baseline-файли конфігурації Stryker/Vitest і пов’язані Vue-файли, щоб проєкт мав узгоджену стартову конфігурацію для mutation testing.

5. `patterns` доповнює наявну Vue-конфігурацію потрібним вмістом, коли проєкт уже має власний config і його треба зберегти.

6. `patterns` додає відсутні тестові патерни до `.gitignore`, щоб службові результати тестування не потрапляли в git.

7. `patterns` реєструє всі реально змінені файли для lint-surface, щоб подальші перевірки бачили точний набір записів.

8. `patterns` не працює з вмістом `.git`, оскільки це службова директорія системи контролю версій.

9. Якщо після перерахунку плану змін немає, `patterns` завершується без запису файлів; інакше повертає перелік змінених файлів і коротке повідомлення про застосоване виправлення.

## Гарантії поведінки

- Свідомо пропускає шляхи: `.git`.
