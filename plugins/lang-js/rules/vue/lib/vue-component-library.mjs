/**
 * Визначає, чи є Vue-пакет бібліотекою компонентів (`vue` оголошено в `peerDependencies`).
 *
 * Такі пакети споживаються Vite-проєктами як залежність; їхні власні джерела **не** проходять
 * через `unplugin-auto-import` споживача (auto-import резолвиться лише в коді самого додатка, не в
 * `node_modules`). Тому в бібліотеці компонентів явні `import { … } from 'vue'` обовʼязкові, і правило
 * авто-імпорту (заборона value-імпортів з `'vue'`) до неї **не** застосовується (vue.mdc).
 *
 * Раніше жив у `vue/packages/main.mjs` (read-only детектор concern-а `packages`, тепер
 * `crates/plugin-lang-js/src/lib.rs` → `detect_vue_packages`/`collect_vue_roots`). Ця чиста
 * функція винесена сюди без зміни поведінки — `test/storybook-scope/main.mjs` (концерн ІНШОГО
 * кластера) імпортує її напряму, тож вона мусить пережити видалення `vue/packages/main.mjs`.
 */

/**
 * @param {{ peerDependencies?: Record<string, string> }} pkg розпарсений package.json
 * @returns {boolean} true, якщо `vue` присутній у `peerDependencies`
 */
export function isVueComponentLibraryPkg(pkg) {
  return Boolean(pkg?.peerDependencies?.vue)
}
