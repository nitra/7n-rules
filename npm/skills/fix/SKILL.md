---
name: n-fix
description: >-
  Виправити проєкт відповідно до всіх правил в .cursor/rules/
---

# n-fix — автоматичне виправлення проєкту

## Scope

Цей скіл відповідає **лише за структуру** проєкту: щоб `.cursor/rules/` + `npx @nitra/cursor fix` були задоволені (наявність конфігів, залежностей, скриптів, GitHub workflows, відсутність заборонених файлів). **Лінт-порушення у самому коді** (ESLint, oxlint, jscpd, cspell, knip, sonarjs, stylelint тощо) — **поза скоупом**; їх діагностує й виправляє **`/n-lint`** (`bun run lint`).

## Workflow

```bash
n_cursor_npx fix
```

Exit 0 = чисто, 1 = є unresolved (перевір вивід — буде список правил що не закрились після 3 ітерацій).

Якщо змінились залежності — `bun i`. Якщо змінились JS/TS файли — `oxfmt .`.

Для конкретних правил: `n_cursor_npx fix bun ga`.
