---
type: JS Module
title: fix-avif_generation.mjs
resource: npm/rules/image-avif/avif_generation/fix-avif_generation.mjs
docgen:
  crc: 3a78f3d4
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 15
---

## Поведінка

Для початку роботи з песимістичними сценаріями викликається `scanAvif`, який виконує комплексний сканування всього етапу AVIF. `scanAvif` покладається на `hasAnyVueRasterReference` для попередньої перевірки наявності raster-посилань, а також викликає `scanVueAvifImports` для сканування всіх workspace-пакетів. `scanVueAvifImports` перевіряє наявність opt-out у `package.json` кожного пакета, і у пакетах, де оптимізація ввімкнена, виконується `scanVueAvifInPackage`. `scanVueAvifInPackage` аналізує `.vue`/`.html` в межах одного пакета, формуючи заплановані `rewrite` (з використанням константи `AVIF_NEEDS_REWRITE`) та фіксуючи провали (з використанням константи `AVIF_MISSING`). Паралельно, `scanAvif` викликає `collectOrphanAvifs`, який аналізує збірку виявлених AVIF-двійників, виключаючи ті, що належать до opt-out пакетів, для визначення сиріт (використовуючи константу `AVIF_ORPHAN`). Після збору всіх даних, `scanAvif` повертає об'єкт `AvifScan`. На етапі генерації, `runAvifGeneration` виконує виклик зовнішнього інструменту з використанням `MINIFY_PACKAGE_NAME` для створення фактичних `.avif` двійників. Після генерації, для підтвердження або виявлення нових помилок (покращення відношення `missing` до `rewrite`), виконується повторне сканування.

## Гарантії поведінки

- Кешує результати в межах одного прогону.
