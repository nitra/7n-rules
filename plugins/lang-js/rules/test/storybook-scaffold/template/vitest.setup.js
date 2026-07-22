/**
 * Setup-файл для vitest-проєкту `storybook` (browser-mode, chromium), підключений через
 * `test.projects[].test.setupFiles` (`vitest-config`-концерн, storybook.mdc, ADR Кластер 5).
 * Той самий файл для ОБОХ типів пакета (library/app, хвиля 2a) — вміст не залежить від
 * конкретного пакета. Стандартний `@storybook/addon-vitest`-boilerplate (офіційна
 * інтеграція Storybook+Vitest): без нього `vitest run --project=storybook` не підключає
 * анотації `.storybook/preview.js` (decorators/loaders/parameters) до browser-тестів.
 * Згенеровано правилом `storybook` — `npx @7n/rules fix storybook` відтворює цей файл,
 * якщо його видалено чи зламано канон.
 */
import { beforeAll } from 'vitest'
import { setProjectAnnotations } from '@storybook/vue3-vite'
import * as previewAnnotations from './preview.js'

const project = setProjectAnnotations([previewAnnotations])

beforeAll(project.beforeAll)
