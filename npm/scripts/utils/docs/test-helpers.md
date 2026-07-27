---
type: JS Module
title: test-helpers.mjs
resource: npm/scripts/utils/test-helpers.mjs
docgen:
  crc: 7f6852cb
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 75
---

## Огляд

Допоміжні функції для тестів скриптів пакета `@7n/rules`: тимчасові
каталоги (без мутації `process.cwd()`) та запис JSON у абсолютний шлях.

**Без `process.chdir`.** Глобальна мутація `process.cwd()` ламає паралельні
vitest workers, що ділять один процес: один тест переключає cwd у tmpdir,
другий — назад у repo root посеред git-операцій першого. Інцидент:
`rules/changelog/.../check.test.mjs` робив `git init`+`git commit` із
`cwd: process.cwd()`, що в результаті race потрапляв у реальний робочий
каталог і створював rogue commits із автором `test <test@test>`.

Контракт: `withTmpDir(fn)` створює tmp-каталог і передає його абсолютний шлях
у `fn`; тест явно будує `join(dir, …)` для будь-яких файлових операцій і
передає `cwd: dir` усім child-процесам (`execFile`, `spawnSync`) та
`await check(dir)` усім concern-функціям. Цей контракт обов'язковий — див.
перевірку `rules/test/js/no-process-chdir.mjs`.

## Публічний API

- withTmpDir — Створює тимчасову директорію, передає її абсолютний шлях у `fn`, потім
видаляє директорію. **НЕ** мутує `process.cwd()`.
- writeJson — Записує JSON-файл з типовим форматуванням і завершальним переносом рядка.
Аргумент `path` має бути абсолютним (від `withTmpDir`-callback-а через
`join(dir, relPath)`).
- ensureDir — Створює вкладені каталоги. Аргумент `path` має бути абсолютним.
- withBinStubInPath — Створює тимчасовий каталог із порожнім виконуваним стабом `<bin>` (`<bin>.exe` на Windows,
`exit 0`), додає каталог на початок `PATH` для тривалості `fn` і потім відновлює оригінальний `PATH`.

Дозволяє ганяти перевірки, що спавнять зовнішні тули, на машинах без реального бінарника
(`resolveCmd(bin)`/`ensureTool(bin)` знайдуть стаб через PATH) і, головне, детерміновано
замінює повільні мережево-залежні тули у тестах: наприклад, реальний `kubescape scan`
на старті тягне артефакти/конфіг із хмарних API (десятки секунд wall-time на
повільній або закритій мережі), що ламає `testTimeout`.
- withShellcheckStubInPath — Спеціалізація {@link withBinStubInPath} для shellcheck: дозволяє ганяти `check ga`
у тестах на машинах без реального shellcheck. Реальний shellcheck не запускається.
- withBinRemovedFromPath — Виконує `fn` із `PATH`, з якого видалені всі каталоги, що містять виконуваний `<bin>`.
Залишок `PATH` не змінюємо — git/bun лишаються доступними. Після `fn` оригінальний `PATH` повертаємо.

Потрібно для негативних тестів («fail, коли інструмента нема»), що мають працювати на машинах,
де користувач уже встановив цей інструмент глобально (наприклад, `brew install shellcheck`).

Додатково виставляє `N_CURSOR_NO_AUTO_INSTALL=1` на час `fn`: інструменти, що резолвляться
через `ensureTool`, інакше спробували б **реальний** brew/scoop/curl-install під час тесту.
- installFakeLangJsPlugin — Ставить у tmp-репо фейковий плагін `@7n/rules-lang-js` (маніфест API v2 з
`doc-files.extensions@1` contribution — JS-екосистема) і активує його через `.n-rules.json`.
Потрібен тестам doc-files: ядро не має вбудованих кодових розширень — без активного
lang-плагіна скан не бачить жодного джерела (Фаза 2, spec
2026-07-27-universal-plugin-slots-lang-php-extraction — переведено на slot bus).

## Сценарії використання

- `npm/scripts/tests/test-helpers.test.mjs` (writeJson / ensureDir — absolute path guard) — writeJson з відносним шляхом кидає помилку (line 53); ensureDir з відносним шляхом кидає помилку (line 65)

## Гарантії поведінки

- Свідомо пропускає шляхи: `node_modules`.
