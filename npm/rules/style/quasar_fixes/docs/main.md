---
type: JS Module
title: main.mjs
resource: npm/rules/style/quasar_fixes/main.mjs
docgen:
  crc: 3eecca4c
---

## Огляд

Детектор concern-а `quasar_fixes` (read-only, whole-repo): якщо `.vue`-файл використовує
`<q-scroll-area>` або `<q-tooltip>`, десь у `.scss`/`.css`/`.vue` проєкту має бути
відповідний CSS-фікс (`.q-scrollarea` / `.q-tooltip`) — інакше порушення
`missing-quasar-fix`. iOS-zoom-фікс (тригер на `input`/`textarea`/`select`) навмисно не
перевіряється — надто загальний тригер, false-positive на майже будь-якій формі. Whole-repo
сканування, не залежить від `ctx.files`.
