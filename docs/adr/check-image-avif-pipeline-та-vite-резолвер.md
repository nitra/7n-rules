# AVIF-pipeline у check image: розподіл відповідальностей, Vite-резолвер та відкат sha1-кешу

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

Скрипт `lint-image` у `package.json` містив прапорець `--avif`, що генерував AVIF-файли під час кожного lint-запуску. Реалізація `resolveImagePath` давала хибні результати для Vite/Quasar-проєктів (де `/path` означає `<pkgRoot>/public/path`, а не корінь ОС), спричиняючи 32 ❌ у реальних монорепо і видалення щойно згенерованих AVIF як orphan. Версія 1.8.195 додала sha1-кеш для інвалідації застарілих AVIF, але `@nitra/minify-image` вже має власний кеш — дублювати логіку між пакетами недоцільно.

## Рішення/Процедура/Факт

**Розподіл відповідальностей:**
- `lint-image` канонічно: `npx @nitra/minify-image --src=. --write` (без `--avif`); присутність `--avif` є помилкою перевірки.
- `npx @nitra/cursor check image` виконує повний триетапний pipeline:
  1. Best-effort `npx @nitra/minify-image --src=. --write --avif` (пропускається через `NITRA_CURSOR_NO_AVIF_RUN=1`).
  2. In-place rewrite статичних `src="…png"` та `import x from '…png'` у `.vue`/`.html` коли `.avif`-двійник існує; динамічні вирази, `data-src=`, SVG — пропускаються.
  3. Orphan-cleanup: видаляє `.avif` без живих посилань; пропускає `dist/`, `build/`, `android/`, `ios/`, `.output/`, `.nuxt/`, `.cache/` та opt-out пакети.

**Резолвер шляхів `resolveImageCandidates`:**
Для абсолютних `/path` пробується: `<pkgRoot>/public<path>` → `<pkgRoot><path>` → `<cwd><path>` (перший де існує `.avif`-двійник). Для голих відносних з `/` (не alias) — відносно файла-джерела + `<pkgRoot>/public/<path>`. Bare module specifiers (без `/`) — пропускаються без fail.

**Відкат sha1-кешу (v1.8.196):**
Функції `deleteStaleAvifs`, `refreshAvifSourceHashCache` та файл `.n-image-avif.tsv` видалено. Інвалідацію застарілих AVIF при зміні вихідного файла реалізовано безпосередньо в `@nitra/minify-image` (де вже є `.n-minify-image.tsv`).

## Обґрунтування

`bun run lint` виконується часто і має бути детермінованим без сайд-ефектів. Rewrite та cleanup — семантично пов'язані операції що мають виконуватись разом і в правильному порядку. Vite/Quasar резолвують `/path` з `public/` — без виправлення перевірка масово фейлила і видаляла валідні AVIF. Дублювати sha1-логіку між двома пакетами — джерело розсинхронізації.

## Розглянуті альтернативи

- Залишити `--avif` у `lint-image` — відхилено: lint не має сайд-ефектів у вигляді нових файлів.
- mtime-based інвалідація — відхилено: mtime непередбачуваний після git checkout.
- Залишити `.n-image-avif.tsv` як bridge — відхилено: плутає відповідальність.
- Резолвити лише через `<cwd>` — не підходить для monorepo з `public/`.

## Зачіпає

`.cursor/rules/n-image.mdc` (v1.5), `npm/mdc/image.mdc`, `npm/scripts/check-image.mjs` (функції `resolveImageCandidates`, `checkVueAvifImportsInPackage`, `cleanupOrphanAvifs`, `check`), `npm/tests/check-image.test.mjs`, `npm/package.json` (v1.8.196), `npm/CHANGELOG.md`, кореневий `package.json` (видалено `--avif` з `lint-image`).
