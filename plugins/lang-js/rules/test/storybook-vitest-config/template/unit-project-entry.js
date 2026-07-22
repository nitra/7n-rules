/**
 * Канонічний вигляд запису `unit`-проєкту у `test.projects` (storybook.mdc,
 * vitest-config-концерн). Сам файл — валідний модуль лише для того, щоб
 * пройти JS-лінт репозиторію правил; `fix-vitest-config.mjs` зчитує лише
 * вміст `export default {...}` і вставляє його як елемент масиву `projects`.
 */
export default { extends: true, test: { name: 'unit' } }
