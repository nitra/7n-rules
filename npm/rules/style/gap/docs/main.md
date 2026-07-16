---
type: JS Module
title: main.mjs
resource: npm/rules/style/gap/main.mjs
docgen:
  crc: dcba23e0
---

## Огляд

Детектор concern-а `gap` (read-only, whole-repo): кожен суфікс утиліти
`.n-gap-{xs,sm,md,lg}`, використаний у `.vue`-файлі, має бути визначений хоч в одному
`.scss`/`.css`/`.vue` файлі проєкту — інакше порушення `missing-gap-style` для цього
суфіксу. Суфікси відстежуються незалежно один від одного, тож часткове покриття все одно
виявляє відсутній. Whole-repo сканування, не залежить від `ctx.files`.
