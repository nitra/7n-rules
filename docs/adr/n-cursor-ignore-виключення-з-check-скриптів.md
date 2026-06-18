---
type: ADR
title: "Розширення семантики поля ignore у .n-cursor.json — виключення з обходу check-скриптів"
---

# Розширення семантики поля ignore у .n-cursor.json — виключення з обходу check-скриптів

**Status:** Accepted
**Date:** 2026-05-05

## Контекст

Поле `ignore` в `.n-cursor.json` існувало лише як сигнал для AI-агентів («не редагувати»), але `check`-скрипти (`npx @nitra/cursor check`) все одно обходили та валідували ці директорії — vendored Helm-чарти (`dremio_v2/`), згенеровані маніфести, legacy-дерева (`postgres-master/` тощо), породжуючи сотні хибних помилок, що не можна було обійти.

## Рішення/Процедура/Факт

- `scripts/utils/walkDir.mjs` — додано третій аргумент `ignorePaths = []`; пропуск каталогу відбувається за повним posix-шляхом (точний збіг або префікс + `/`), а не за basename. Стандартні пропуски (`node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next`) лишились незмінними.
- `scripts/utils/load-cursor-config.mjs` (новий файл) — утиліта `loadCursorIgnorePaths(root)`: читає `.n-cursor.json`, нормалізує `ignore` до абсолютних posix-шляхів без trailing-slash, повертає `[]` якщо файлу або поля немає.
- 13 check/run-скриптів оновлено: кожен викликає `loadCursorIgnorePaths(root)` на старті `check()` і пробрасовує у `walkDir` та wrapper-функції збору файлів.
- `schemas/n-cursor.json` — опис поля `ignore` розширено: «повне виключення з обходу check-скриптів і AI-модифікацій; стандартні пропуски додавати не треба».
- `README.md` — додано секцію «Виключення цілих дерев — поле `ignore`» з прикладом.
- Нові тести: 5 кейсів для `walkDir` (повний шлях vs basename, відносні шляхи, trailing-slash, порожній масив) та 7 кейсів для `loadCursorIgnorePaths`. Версія: 1.8.172 → 1.8.173.

## Обґрунтування

Порівняння за повним шляхом від кореня (а не basename) критично: `postgres-master/` не повинно блокувати `postgres-master-test/`. Шляхи в `ignore` є відносними від кореня репозиторію (posix), тому normalize → absolute → prefix-match є єдиним коректним підходом. Утиліта `loadCursorIgnorePaths` виділена окремо для перевикористання та уникнення дублювання читання `.n-cursor.json`.

## Розглянуті альтернативи

Підтримка glob-патернів (`**/dremio_v2`) через `picomatch` розглядалась як «бонусна» опція, але відкладена на користь простих точних префіксів шляхів.

## Зачіпає

`npm/scripts/utils/walkDir.mjs`, `npm/scripts/utils/load-cursor-config.mjs` (новий), усі `npm/scripts/check-*.mjs` та `npm/scripts/run-*.mjs` що використовують `walkDir`, `npm/schemas/n-cursor.json`, `npm/README.md`, `npm/tests/utils-walkDir.test.mjs`, `npm/tests/utils-load-cursor-config.test.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.
