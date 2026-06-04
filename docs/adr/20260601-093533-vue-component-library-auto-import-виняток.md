# Vue: виняток auto-import стеку для бібліотек компонентів

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

Правило `vue.mdc` вимагало `unplugin-auto-import` і забороняло явні `import { … } from 'vue'` для всіх пакетів із `vue` у `dependencies`. Бібліотеки компонентів (де `vue` у `peerDependencies`) мають явні Vue-імпорти, але їхні джерела не проходять через `unplugin-auto-import` споживача — вони постачаються скомпільованими. Застосування правила давало хибні спрацьовування.

## Considered Options

* Виняток лише для `import { … } from 'vue'`, решта правил залишається
* Повний виняток усього стеку auto-import для пакетів із `vue` у `peerDependencies`

## Decision Outcome

Chosen option: "Повний виняток усього стеку auto-import для бібліотек компонентів", because часткове виключення залишало б хибні спрацьовування на `vite.config`; стек налаштовується у Vite-проєкті-споживачі, не в бібліотеці.

### Consequences

* Good, because `check vue` на бібліотеці з `import { ref } from 'vue'` більше не видає помилок; Vite-застосунки перевіряються без змін.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `npm/rules/vue/js/packages.mjs` — хелпер `isVueComponentLibraryPkg(pkg)`: `true` якщо `vue` у `peerDependencies`
- Ознака протягнута через `collectVueRoots` → `checkVuePackage` → `checkViteConfig` / `checkVueImportViolations`
- Пропускається: скан value-імпортів, вимога `'vue'` у `AutoImport.imports`, вимога `VueMacros`/`AutoImport` у `vite.config`; виводиться `[component-library] auto-import стек не вимагається`
- Документація: `vue.mdc` і `n-vue.mdc` v2.0 → v2.1
- Тести: `component-library.test.mjs` (6 кейсів); vue-сюїта 23 passed
- Change-файл: `npm/.changes/1780294523083-0964b2.md` (minor / Changed)
