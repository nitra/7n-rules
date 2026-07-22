/**
 * Детекція Storybook-workspace-ів (Vue-компонентні бібліотеки зі сторі), покриття
 * яких рахує vitest browser mode (named-проєкт "storybook", лише chromium).
 * Детекція — за каноном Storybook (ADR «Канон Storybook для Vue-компонентних
 * бібліотек», Кластер 7): Storybook-identity-пакети живуть у `devDependencies`
 * `package.json` workspace-пакета (`npm/package.json` консюмер-репо), і governance
 * (`npm-module/npm_package_json.rego` у `@7n/rules-lang-js`) забороняє там будь-які
 * інші devDeps та пінить точні версії identity-пакетів. Тож наявність хоча б одного
 * identity-пакета в `devDependencies` — достатній і надійний сигнал Storybook-root.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { walk } from './fs-walk.mjs'

/** `*.stories.*` файли — не production-код, окремий вимір покриття (Storybook, не JS-рядок). */
export const STORIES_FILE_RE = /\.stories\.[^.]+$/

/**
 * Канонічний allowlist Storybook-identity devDeps (канон Storybook, Кластер 7;
 * версії запінені в `npm-module/npm_package_json.rego` репо 7n-rules).
 * `@storybook/addon-vitest` СВІДОМО не тут: це root-only test-tooling (плагін
 * vitest-конфіга, `bun/package_json.rego#allowed_root_test_deps`), а не
 * identity-маркер Storybook-пакета.
 */
export const STORYBOOK_CANON_DEV_DEPS = [
  'storybook',
  '@storybook/vue3-vite',
  '@storybook/vue3',
  'msw',
  'msw-storybook-addon'
]

/**
 * Чи workspace — канонічний Storybook-пакет: хоча б один identity-пакет із
 * {@link STORYBOOK_CANON_DEV_DEPS} у `devDependencies` його `package.json`.
 * Лише `devDependencies` (не `dependencies`) — канон тримає identity-пакети саме
 * там; тека `.storybook/` не сигнал (скафолд гарантує правило `storybook`, а
 * детекція за самим `package.json` бачить пакет ще до скафолду).
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @returns {Promise<boolean>} true для канонічного Storybook-пакета
 */
export async function isStorybookRoot(jsRoot) {
  const pkgPath = join(jsRoot, 'package.json')
  if (!existsSync(pkgPath)) return false
  let pkg
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  } catch {
    return false
  }
  const devDeps = pkg.devDependencies ?? {}
  return STORYBOOK_CANON_DEV_DEPS.some(name => Boolean(devDeps[name]))
}

/**
 * Чи workspace має хоч один `*.stories.*` файл (`node_modules`/`dist`/… не скануються).
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @returns {Promise<boolean>} true, якщо знайдено хоча б один сторі-файл
 */
export async function hasStories(jsRoot) {
  let found = false
  await walk(jsRoot, abs => {
    if (STORIES_FILE_RE.test(abs)) found = true
  })
  return found
}
