/** @see ./docs/vue.md */
import {
  extractFileHeader,
  extractExports,
  extractImports,
  extractInternalSymbols,
  extractLocalSymbols,
  extractMarkers,
  parseJsDoc
} from './js-facts.mjs'
import { extractUnitsJs } from './units-js.mjs'

/**
 * `vue/compiler-sfc` — optional peer (plugins/lang-js package.json). Без пакета
 * `parseSFC`/`compileScriptSfc` лишаються `null` — `extractFactsVue`/`extractUnitsVue`
 * деградують до `unsupported`/`null`, а не кидають (`loadDocFilesExtractors` інакше
 * мовчки прибрав би весь handler-модуль, разом із js/ts-екстрактором).
 */
let parseSFC = null
let compileScriptSfc = null
try {
  const compilerSfc = await import('vue/compiler-sfc')
  parseSFC = compilerSfc.parse
  compileScriptSfc = compilerSfc.compileScript
} catch {
  // vue не встановлено — очікувана деградація, не помилка
}

const SLOT_COMMENT_RE = /<!--\s{0,20}@slot\s{1,20}(\S{1,200})\s{0,20}([^]{0,2000}?)-->/g
const DEFINE_PROPS_RE = /\bdefineProps\s{0,10}(?:<[^]{0,4000}?>)?\s{0,10}\(/
const DEFINE_EMITS_RE = /\bdefineEmits\s{0,10}(?:<[^]{0,4000}?>)?\s{0,10}\(/
const DEFINE_EXPOSE_RE = /\bdefineExpose\s{0,10}\(/
const EMIT_ARRAY_RE = /defineEmits\s{0,10}\(\s{0,10}\[([^\]]{0,2000})\]/
const EMIT_TYPE_EVENT_RE = /\(\s{0,10}e\s{0,10}:\s{0,10}['"]([^'"]{1,200})['"]/g
// Межа поля усередині `defineProps<{...}>()` — статичний regex (без RegExp(name),
// security/detect-non-literal-regexp): шукається окремо для кожного імені через
// `String#indexOf` + перевірку меж слова.
const WORD_CHAR_RE = /[\w$]/
// `(?!\/)` одразу після відкриття — той самий захист від glob-рядків `/**/`, що й
// у `PRECEDING_JSDOC_RE` (js-facts.mjs).
const PRECEDING_BLOCK_COMMENT_RE = /\/\*\*(?!\/)(?:(?!\*\/)[^]){0,2000}\*\/\s{0,10}$/
const OBJECT_KEY_RE = /(?:^|,)\s{0,10}([\w$]{1,80})\s{0,10}(?::|,|$)/g
const OBJECT_LITERAL_RE = /\{([^]{0,4000})\}/
const VUE_EXT = '.vue'
// `interface Name {`/`type Name = {` — заголовок оголошення типу, до якого
// `defineProps<Name>()` (generic-посилання, не inline-літерал) відсилає.
const TYPE_DECL_HEAD_RE = /^\s{1,10}([\w$]{1,80})\s{0,10}(?:=\s{0,10})?\{/
const GENERIC_TYPE_NAME_RE = /<\s{0,10}([\w$]{1,80})\s{0,10}>/
const EMPTY_UNSUPPORTED = relPath => ({
  relPath,
  lang: 'vue',
  unsupported: true,
  header: '',
  exports: [],
  imports: {},
  markers: {}
})

/**
 * Парсить SFC у дескриптор, з обробкою невалідного вхідного джерела.
 * @param {string} src вміст .vue-файлу
 * @param {string} relPath шлях (для помилок компілятора)
 * @returns {object|null} дескриптор SFC або null (парсер відсутній/файл невалідний)
 */
function parseDescriptor(src, relPath) {
  if (!parseSFC) return null
  try {
    const { descriptor } = parseSFC(src, { filename: relPath })
    return descriptor
  } catch {
    return null
  }
}

/**
 * Span виклику `name(...)` з урахуванням вкладених дужок (для generic-типів і
 * вкладених об'єктів усередині `defineProps<{...}>()`/`defineEmits(...)`).
 * @param {string} content вміст script-блоку
 * @param {RegExp} re regex відкриття виклику (закінчується на `(`)
 * @returns {{start:number, end:number, text:string}|null} межі виклику або null
 */
function extractCallSpan(content, re) {
  const m = content.match(re)
  if (!m) return null
  const openAt = m.index + m[0].length - 1
  let depth = 1
  let i = openAt + 1
  for (; i < content.length && depth > 0; i++) {
    if (content[i] === '(') depth++
    else if (content[i] === ')') depth--
  }
  return { start: m.index, end: i, text: content.slice(m.index, i) }
}

/**
 * Імена props із `compileScript().bindings` (типи `props`/`props-aliased`) —
 * єдине надійне джерело фактичних імен (regex над generic-типами ненадійний).
 * @param {Record<string,string>|null} bindings bindingMetadata із compileScript
 * @returns {string[]} імена props
 */
function propNamesFromBindings(bindings) {
  if (!bindings) return []
  return Object.entries(bindings)
    .filter(([, kind]) => kind === 'props' || kind === 'props-aliased')
    .map(([name]) => name)
}

/**
 * JSDoc-коментар безпосередньо перед словом-межею `name` (`name:`/`name?:`) у
 * тексті визначення — ручний пошук через `String#indexOf` замість `RegExp(name)`
 * (security/detect-non-literal-regexp): кожне входження `name` перевіряється на
 * межі слова, і лише праворуч від `?`/`:` вважається полем-визначенням.
 * @param {string} spanText текст виклику `defineProps<{...}>()`/об'єктного визначення
 * @param {string} name імʼя поля (з bindings)
 * @returns {string} опис поля або порожній рядок
 */
function propDescFromSpan(spanText, name) {
  let from = 0
  while (from < spanText.length) {
    const at = spanText.indexOf(name, from)
    if (at === -1) return ''
    const before = at > 0 ? spanText[at - 1] : ''
    const after = spanText[at + name.length] ?? ''
    if (!WORD_CHAR_RE.test(before) && !WORD_CHAR_RE.test(after) && (after === '?' || after === ':')) {
      const m = spanText.slice(0, at).match(PRECEDING_BLOCK_COMMENT_RE)
      return m ? parseJsDoc(m[0]).desc : ''
    }
    from = at + name.length
  }
  return ''
}

/**
 * Тіло фігурних дужок, що починаються рівно у позиції `openAt` (яка має вказувати
 * на `{`), з урахуванням вкладеності.
 * @param {string} content текст, у якому шукається тіло
 * @param {number} openAt індекс відкриваючої `{`
 * @returns {string} вміст між `{` і відповідною `}` (без самих дужок)
 */
function braceBodyAt(content, openAt) {
  let depth = 1
  let i = openAt + 1
  for (; i < content.length && depth > 0; i++) {
    if (content[i] === '{') depth++
    else if (content[i] === '}') depth--
  }
  return content.slice(openAt + 1, i - 1)
}

/**
 * Тіло `interface Name {...}`/`type Name = {...}` за іменем типу — для
 * generic-посилання `defineProps<Name>()` (типова декларація окремо від виклику).
 * Ручний пошук через `String#indexOf` (без `RegExp(name)`, той самий підхід, що й
 * у `propDescFromSpan`).
 * @param {string} content вміст script-блоку
 * @param {string} typeName імʼя типу (interface/type alias)
 * @returns {string} тіло оголошення або порожній рядок, якщо не знайдено
 */
function findTypeDeclBody(content, typeName) {
  for (const kw of ['interface', 'type']) {
    let from = 0
    while (from < content.length) {
      const at = content.indexOf(kw, from)
      if (at === -1) break
      const before = at > 0 ? content[at - 1] : ''
      if (!WORD_CHAR_RE.test(before)) {
        const head = content.slice(at + kw.length, at + kw.length + 200).match(TYPE_DECL_HEAD_RE)
        if (head && head[1] === typeName) {
          const openAt = at + kw.length + head[0].length - 1
          return braceBodyAt(content, openAt)
        }
      }
      from = at + kw.length
    }
  }
  return ''
}

/**
 * Ділянка тексту для пошуку опису props: inline-літерал типу всередині самого
 * виклику (`defineProps<{...}>()`/`defineProps({...})`) або, якщо виклик лише
 * посилається на імʼя типу (`defineProps<Props>()`), тіло окремої декларації
 * `interface Props {...}`/`type Props = {...}`.
 * @param {string} content вміст script-блоку
 * @param {{text:string}|null} span span виклику `defineProps(...)`
 * @returns {string} текст для пошуку полів (може бути порожнім)
 */
function propsSearchArea(content, span) {
  if (!span) return ''
  if (span.text.includes('{')) return span.text
  const ref = span.text.match(GENERIC_TYPE_NAME_RE)
  return ref ? findTypeDeclBody(content, ref[1]) : ''
}

/**
 * Факти про props: імена — з bindings, опис — з JSDoc-коментаря безпосередньо
 * перед полем усередині `defineProps<{...}>()`/`defineProps<Name>()` (з окремою
 * декларацією `Name`)/об'єктного визначення (яке з них присутнє).
 * @param {string} content вміст script-блоку
 * @param {Record<string,string>|null} bindings bindingMetadata із compileScript
 * @returns {Array<{name:string, kind:'prop', desc:string, params:[], ret:''}>} псевдо-експорти props
 */
function extractPropsFacts(content, bindings) {
  const names = propNamesFromBindings(bindings)
  if (!names.length) return []
  const span = extractCallSpan(content, DEFINE_PROPS_RE)
  const searchArea = propsSearchArea(content, span)
  return names.map(name => ({ name, kind: 'prop', desc: propDescFromSpan(searchArea, name), params: [], ret: '' }))
}

/**
 * Імена подій із `defineEmits(['a','b'])` (масив) або `defineEmits<{ (e:'a'):void }>()`
 * (типовий літерал з викличними сигнатурами).
 * @param {string} content вміст script-блоку
 * @returns {string[]} імена подій
 */
function extractEmitNames(content) {
  const arr = content.match(EMIT_ARRAY_RE)
  if (arr) {
    return arr[1]
      .split(',')
      .map(s => s.trim().replaceAll(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  }
  const span = extractCallSpan(content, DEFINE_EMITS_RE)
  if (!span) return []
  const names = new Set()
  for (const m of span.text.matchAll(EMIT_TYPE_EVENT_RE)) names.add(m[1])
  return [...names]
}

/**
 * Псевдо-експорти для подій — опис свідомо порожній (Stage 3 LLM-gap дозаповнить
 * при генерації, тут — лише перелік валідних імен, без фабрикації опису regex-ом).
 * @param {string} content вміст script-блоку
 * @returns {Array<{name:string, kind:'emit', desc:'', params:[], ret:''}>} псевдо-експорти emits
 */
function extractEmitsFacts(content) {
  return extractEmitNames(content).map(name => ({ name, kind: 'emit', desc: '', params: [], ret: '' }))
}

/**
 * Імена експонованих через `defineExpose({ a, b })` — ключі об'єктного літерала
 * (shorthand або `key: value`), без вкладеного парсингу типів.
 * @param {string} content вміст script-блоку
 * @returns {string[]} імена exposed-полів
 */
function extractExposedNames(content) {
  const span = extractCallSpan(content, DEFINE_EXPOSE_RE)
  if (!span) return []
  const obj = span.text.match(OBJECT_LITERAL_RE)
  if (!obj) return []
  const names = new Set()
  for (const m of obj[1].matchAll(OBJECT_KEY_RE)) names.add(m[1])
  return [...names]
}

/**
 * Псевдо-експорти для `defineExpose` — опис порожній з тієї ж причини, що й emits.
 * @param {string} content вміст script-блоку
 * @returns {Array<{name:string, kind:'exposed', desc:'', params:[], ret:''}>} псевдо-експорти exposed
 */
function extractExposedFacts(content) {
  return extractExposedNames(content).map(name => ({ name, kind: 'exposed', desc: '', params: [], ret: '' }))
}

/**
 * `<!-- \@slot name опис -->` з довільного місця файлу (як правило — `<template>`).
 * @param {string} src повний вміст .vue-файлу
 * @returns {Array<{name:string, desc:string}>} задокументовані слоти
 */
function extractSlots(src) {
  return Array.from(src.matchAll(SLOT_COMMENT_RE), m => ({ name: m[1], desc: m[2].trim() }))
}

/**
 * Факт-лист для Vue SFC (`<script setup>` пріоритетний над звичайним `<script>`):
 * повторне використання JS-хелперів над вмістом script-блоку + props/emits/exposed як псевдо-експорти
 * (потрапляють у «Публічний API» нарівні зі звичайними export) + слоти з `@slot`-коментарів
 * шаблону. Без `vue/compiler-sfc` (peer не встановлено) чи без script-блоку/невалідного
 * SFC — `unsupported: true` (whole-file шлях, без краху батчу).
 * @param {string} src вміст .vue-файлу
 * @param {string} relPath шлях файлу
 * @returns {object} факт-лист (сумісний з js/ts-екстрактором + `slots`) або `unsupported`-заглушка
 */
export function extractFactsVue(src, relPath) {
  const descriptor = parseDescriptor(src, relPath)
  if (!descriptor) return EMPTY_UNSUPPORTED(relPath)
  const scriptBlock = descriptor.scriptSetup ?? descriptor.script
  if (!scriptBlock) return EMPTY_UNSUPPORTED(relPath)
  const content = scriptBlock.content

  let bindings = null
  if (compileScriptSfc) {
    try {
      bindings = compileScriptSfc(descriptor, { id: relPath }).bindings
    } catch {
      bindings = null
    }
  }

  return {
    relPath,
    lang: 'vue',
    header: extractFileHeader(content),
    exports: [
      ...extractExports(content),
      ...extractPropsFacts(content, bindings),
      ...extractEmitsFacts(content),
      ...extractExposedFacts(content)
    ],
    imports: extractImports(content),
    internalSymbols: extractInternalSymbols(content),
    localSymbols: extractLocalSymbols(content),
    markers: extractMarkers(content),
    slots: extractSlots(src)
  }
}

/**
 * Юніти Vue SFC: `extractUnitsJs` над вмістом script-блоку зі зміщенням `span`
 * (символьні офсети) на позицію блоку у повному файлі — SFC-компілятор рахує
 * офсети відносно блоку, а anchors/CRC мають вказувати на позиції у файлі.
 * @param {string} src вміст .vue-файлу
 * @param {string} relPath шлях файлу
 * @returns {Array<object>|null} юніти (offsets file-relative) або null
 */
export function extractUnitsVue(src, relPath) {
  const descriptor = parseDescriptor(src, relPath)
  if (!descriptor) return null
  const scriptBlock = descriptor.scriptSetup ?? descriptor.script
  if (!scriptBlock) return null
  // `relPath` закінчується на `.vue` — oxc обирає мову парсингу з розширення
  // (`langFromPath`), тож `.vue` мовчки впав би на `js` і зламав TS-синтаксис
  // (`interface`, generics) у `<script setup lang="ts">`. Віртуальний шлях з
  // розширенням script-блоку виправляє вибір мови, не позначаючи реальний файл.
  const virtualExt = scriptBlock.lang === 'ts' ? '.ts' : '.js'
  const virtualPath = relPath.slice(0, relPath.length - VUE_EXT.length) + virtualExt
  const units = extractUnitsJs(scriptBlock.content, virtualPath)
  if (!units) return null
  const offset = scriptBlock.loc.start.offset
  return units.map(u => ({ ...u, span: { start: u.span.start + offset, end: u.span.end + offset } }))
}
