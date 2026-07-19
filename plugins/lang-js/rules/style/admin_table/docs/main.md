---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/style/admin_table/main.mjs
docgen:
  crc: 267496d1
---

## Огляд

Детектор concern-а `admin_table` (read-only, whole-repo): якщо десь у `.vue`-файлі
використано клас `n-admin-table`, він має бути визначений хоч в одному `.scss`/`.css`/`.vue`
файлі проєкту, інакше — порушення `missing-admin-table-style`. Потребує whole-repo
сканування (usage і definition можуть бути в різних файлах), тому не залежить від `ctx.files`.
