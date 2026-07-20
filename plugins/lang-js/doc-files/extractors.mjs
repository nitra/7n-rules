/** @see ./docs/extractors.md */
import { extractUnitsJs } from './units-js.mjs'
import { extractFactsVue, extractUnitsVue } from './vue.mjs'
import {
  extractFileHeader,
  extractExports,
  extractImports,
  extractInternalSymbols,
  extractLocalSymbols,
  extractMarkers
} from './js-facts.mjs'

/**
 * Мовний doc-files-екстрактор JS-екосистеми для конвеєра `@7n/rules`
 * (extension-point `doc-files`, фаза 5b spec lang-plugins-extraction: ядро —
 * двигун без мовної специфіки): факт-лист (`extractFacts`) для js/mjs/ts і
 * юніти (`extractUnits`) через oxc AST. Розширення `.js`/`.mjs`/`.ts`/`.vue`
 * та їхні OKF-типи декларуються маніфестом плагіна
 * (`contributes.docFiles.extensions`) — hot-path ядра читає їх синхронно;
 * цей модуль вантажиться лише на шляху генерації. Низькорівневі regex-хелпери —
 * у `js-facts.mjs` (спільні з `vue.mjs`, без циклічного імпорту між ними).
 */

/**
 * Головний екстрактор: код файлу → факт-лист.
 * @param {string} src вміст файлу
 * @param {string} relPath шлях (для контексту/мови екстрактора)
 * @returns {{relPath:string, lang:string, header:string, exports:Array, imports:object, markers:object}} структура фактів про файл
 */
export function extractFacts(src, relPath) {
  const lang = relPath.split('.').pop()
  if (lang === 'vue') return extractFactsVue(src, relPath)
  if (!['js', 'mjs', 'ts'].includes(lang)) {
    return { relPath, lang, unsupported: true, header: '', exports: [], imports: {}, markers: {} }
  }
  return {
    relPath,
    lang,
    header: extractFileHeader(src),
    exports: extractExports(src),
    imports: extractImports(src),
    internalSymbols: extractInternalSymbols(src),
    localSymbols: extractLocalSymbols(src),
    markers: extractMarkers(src)
  }
}

/**
 * Юніти для js/mjs/ts (oxc AST) та `.vue` (script-блок SFC, зміщення офсетів на
 * позицію блоку у файлі — див. `extractUnitsVue`).
 * @param {string} src вміст файлу
 * @param {string} relPath шлях (вибір мови/гілки екстрактора)
 * @returns {Array<object>|null} юніти або null, якщо файл не парситься
 */
function extractUnits(src, relPath) {
  return relPath.endsWith('.vue') ? extractUnitsVue(src, relPath) : extractUnitsJs(src, relPath)
}

/**
 * Default-експорт для handler-модуля extension-point `doc-files`.
 * `.vue` — через optional peer `vue/compiler-sfc` (`./vue.mjs`): за наявності пакета
 * повертає повний факт-лист (orchestrated-шлях), без нього — `unsupported` (деградація
 * до whole-file шляху, як і до винесення).
 * @type {{ id: string, extensions: string[], extractFacts: typeof extractFacts, extractUnits: typeof extractUnits }}
 */
const jsDocFilesExtractor = {
  id: 'js',
  extensions: ['.js', '.mjs', '.ts', '.vue'],
  extractFacts,
  extractUnits
}

export default jsDocFilesExtractor
