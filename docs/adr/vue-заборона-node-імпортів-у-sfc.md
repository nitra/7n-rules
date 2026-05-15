# Заборона Node-нативних імпортів у Vue SFC

**Status:** Accepted
**Date:** 2026-05-05

## Контекст

Vue-компоненти (`.vue` SFC) не повинні безпосередньо імпортувати Node-нативні модулі (наприклад, `import { setTimeout as sleep } from 'node:timers/promises'`), оскільки браузерне середовище їх не підтримує — такий код ламає бандлинг або провалюється в рантаймі.

## Рішення/Процедура/Факт

Додано новий сканер у `npm/scripts/utils/vue-forbidden-imports.mjs`, який виявляє імпорти Node-нативних модулів (як з префіксом `node:`, так і bare-ім'я типу `fs`, `path`, `timers/promises` тощо) у `.vue` файлах через oxc-parser. Сканер підключено до `npm/scripts/check-vue.mjs` як окремий прохід по SFC. Тести додано у `npm/tests/vue-forbidden-imports.test.mjs` та `npm/tests/check-rule-fixtures.test.mjs`. Правило задокументовано в `npm/mdc/vue.mdc` та `.cursor/rules/n-vue.mdc` (v1.4 → v1.5). Версія: 1.8.177 → 1.8.178.

## Обґрунтування

Node-нативні модулі несумісні з браузером. Автоматична перевірка через `npx @nitra/cursor check vue` запобігає появі таких імпортів без ручного рев'ю.

## Розглянуті альтернативи

Не обговорювалися; підхід через oxc-parser вже використовувався для аналогічного сканування заборонених `vue`-імпортів.

## Зачіпає

`npm/scripts/utils/vue-forbidden-imports.mjs`, `npm/scripts/check-vue.mjs`, `npm/tests/vue-forbidden-imports.test.mjs`, `npm/tests/check-rule-fixtures.test.mjs`, `npm/mdc/vue.mdc`, `.cursor/rules/n-vue.mdc`, `npm/package.json`, `npm/CHANGELOG.md`.
