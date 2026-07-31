---
type: JS Module
title: fix-linux_deps.mjs
resource: npm/rules/tauri/linux_deps/fix-linux_deps.mjs
docgen:
  crc: eefaab98
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 55
---

## Поведінка

`patterns` використовує `violations` для фільтрації цільових файлів залежно від `kind` (MISSING_LINUX_DEPS_STEP або MISSING_LINUX_DEPS_PACKAGES). Для кожного зі збігів викликається відповідний функціонал, що використовує `insertLinuxDepsStep` або `appendMissingPackages`. Ці функції отримують вміст цільового файлу та повертають оновлений вміст, якщо зміни були внесені. Успішне повернення оновленого вмісту дозволяє циклику застосування тексту (`applyToFiles`) записати зміни до файлу. `insertLinuxDepsStep` або `appendMissingPackages` викликають `scanLinuxDeps` для аналізу вмісту: шукають індекс рядка з `apt-get install` та визначають відсутні пакети, що є основою для прийняття рішення про внесення змін.

## Гарантії поведінки

- Кешує результати в межах одного прогону.
