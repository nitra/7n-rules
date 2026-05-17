# k8s: `pathHasK8sSegment` перевіряє відносний шлях від кореня репо

**Status:** Accepted
**Date:** 2026-05-11

## Контекст

Функція `pathHasK8sSegment` перевіряла наявність сегмента `k8s` в абсолютному шляху до файлу. Якщо кореневий каталог репозиторію сам містив компонент `k8s` у своїй абсолютній адресі (наприклад `/Users/…/abie/k8s/`), функція повертала `true` для будь-якого файлу проєкту — зокрема для `.github/workflows/apply-k8s.yml`. Це спричиняло хибно-позитивний результат: `check-k8s.mjs` вимагав перейменувати файли GitHub Actions з `.yml` на `.yaml`, конфліктуючи з правилом `ga.mdc`.

## Рішення/Процедура/Факт

- Сигнатуру `pathHasK8sSegment` у `check-k8s.mjs` та `run-k8s.mjs` змінено на `pathHasK8sSegment(filePath, root?)` — коли `root` передано, шлях спочатку перетворюється на відносний через `path.relative(root, filePath)` перед пошуком компонента `k8s`.
- У `findK8sYamlFiles` (у трьох файлах) додано передачу `root` та ранній `return` для шляхів під `.github/` як додатковий захист (defense-in-depth).
- У `k8s.mdc` (версія 1.29) додано параграф «Скоп — поза `.github/`»: визначення k8s-скопу є відносним до кореня репо, а `.github/workflows/` і `.github/actions/` належать до зони відповідальності `ga.mdc`.
- Додано нові тести у `check-k8s-schema.test.mjs` (worst-case `/tmp/some/k8s/…`) та `run-k8s-roots.test.mjs` (репо з кореневим ім'ям `k8s/`, `.github/workflows/apply-k8s.yml` не потрапляє до `findK8sRoots`).
- Версію пакету підвищено з `1.9.2` до `1.9.3`, додано запис у `npm/CHANGELOG.md`.

## Обґрунтування

Семантика «файл є k8s-маніфестом» визначається відносним розташуванням у репозиторії, а не абсолютним шляхом на файловій системі. Без параметра `root` будь-який батьківський каталог з іменем `k8s` у абсолютному шляху «заражав» усі файли проєкту і робив перевірку непередбачуваною.

## Розглянуті альтернативи

- Заглушити проблему раннім `return` лише у `checkK8sYamlFile` — відхилено, оскільки `findK8sYamlFiles` все одно включала б workflows до списків для `runAllK8sRego` та `validateKustomization*`.
- Виключити `.github/` у `walkDir` ignorePaths — відхилено як надто широке: `walkDir` використовується і в інших перевірках, не пов'язаних з k8s.

## Зачіпає

- `npm/scripts/check-k8s.mjs`
- `npm/scripts/run-k8s.mjs`
- `npm/scripts/check-abie.mjs`
- `npm/mdc/k8s.mdc`
- `npm/tests/check-k8s-schema.test.mjs`
- `npm/tests/run-k8s-roots.test.mjs`
- `npm/package.json`
- `npm/CHANGELOG.md`
