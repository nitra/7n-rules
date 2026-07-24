/** @see ./docs/lang-extensions.md */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  getDocFilesExtensions,
  getHandlers,
  getUnavailableDeclaredPlugins
} from '../../../scripts/lib/resolve-plugins.mjs'

/**
 * Мовні розширення doc-files від плагінів (фаза 4 spec lang-plugins-extraction).
 *
 * Розширення (`.rs` → 'Rust Module') декларуються в МАНІФЕСТІ плагіна
 * (`n-rules.contributes.docFiles.extensions`) — hot-path (hook на кожен файл)
 * читає їх синхронно без динамічного import. Екстрактори фактів/юнітів —
 * у handler-модулі (`contributes.handlers['doc-files']`), вантажаться лише
 * на асинхронному шляху генерації.
 */

/** Кеш ініціалізації на процес: cwd → мапа розширення → тип-мітка. */
const EXT_CACHE = new Map()
/** Кеш завантажених екстракторів: cwd → мапа розширення → модуль-екстрактор. */
const EXTRACTOR_CACHE = new Map()

/**
 * Синхронно читає `plugins` з `.n-rules.json` (легка версія: лише це поле,
 * без merge/схем — той самий контракт, що `readNRulesConfigLite`, але sync
 * для hot-path).
 * @param {string} cwd корінь репозиторію
 * @returns {{ plugins?: string[] }} конфіг-стаб для resolvePlugins
 */
function readPluginsConfigSync(cwd) {
  for (const name of ['.n-rules.json', '.n-cursor.json']) {
    const p = join(cwd, name)
    if (!existsSync(p)) continue
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      return { plugins: parsed.plugins }
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * Мапа doc-files-розширень від плагінів для репо (`.rs` → 'Rust Module', …),
 * з кешем на процес. Порожня мапа — жодний активний плагін їх не декларує.
 * @param {string} cwd корінь репозиторію
 * @returns {Record<string, string>} розширення → тип-мітка
 */
export function pluginDocFilesExtensions(cwd) {
  const cached = EXT_CACHE.get(cwd)
  if (cached) return cached
  const out = getDocFilesExtensions(cwd, readPluginsConfigSync(cwd))
  EXT_CACHE.set(cwd, out)
  return out
}

/**
 * Асинхронно вантажить мовні екстрактори з handler-модулів плагінів
 * (extension-point `doc-files`): default-експорт
 * `{ id, extensions: string[], extractFacts?, extractUnits? }`.
 * Битий модуль — мовчазний пропуск (генерація тоді йде whole-file шляхом).
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<Map<string, { id: string, extractFacts?: (src: string, relPath: string) => object, extractUnits?: (src: string, relPath: string) => Array<object>|null }>>} розширення → екстрактор
 */
export async function loadDocFilesExtractors(cwd) {
  const cached = EXTRACTOR_CACHE.get(cwd)
  if (cached) return cached
  const map = new Map()
  for (const handler of getHandlers(cwd, readPluginsConfigSync(cwd), 'doc-files')) {
    try {
      // eslint-disable-next-line no-unsanitized/method
      const mod = await import(pathToFileURL(handler.modulePath).href)
      const extractor = mod.default
      if (!extractor || typeof extractor !== 'object' || !Array.isArray(extractor.extensions)) continue
      for (const ext of extractor.extensions) map.set(ext, extractor)
    } catch {
      /* битий handler — пропускаємо, доки згенеруються whole-file шляхом */
    }
  }
  EXTRACTOR_CACHE.set(cwd, map)
  return map
}

/**
 * Задекларовані у `.n-rules.json` плагіни, недоступні в `node_modules` — рахується лише
 * коли мапа doc-files-розширень порожня (інакше принаймні один плагін реально доступний,
 * шукати "недоступні" немає сенсу — не hot-path concern, рахується лише в рідкісному
 * порожньому випадку).
 * @param {string} cwd корінь репозиторію
 * @returns {string[]} npm-імена задекларованих, але не встановлених плагінів (порожньо — усе гаразд)
 */
export function unavailableDocFilesPlugins(cwd) {
  if (Object.keys(pluginDocFilesExtensions(cwd)).length > 0) return []
  return getUnavailableDeclaredPlugins(cwd, readPluginsConfigSync(cwd))
}

/** Скидає кеші (для тестів). */
export function clearDocFilesLangCache() {
  EXT_CACHE.clear()
  EXTRACTOR_CACHE.clear()
}
