/** @see ./docs/vue.md */

// Optional peer `vue`: компілятор резолвиться один раз при завантаженні модуля.
// Свідомо НЕ статичний import — без установленого peer модуль має лишитися
// робочим (extractFactsVue → unsupported), а не завалити весь handler lang-js
// (catch у loadDocFilesExtractors мовчки прибрав би і JS/TS-екстрактор).
let compilerSfc = null
try {
  compilerSfc = await import('vue/compiler-sfc')
} catch {
  /* peer `vue` не встановлено — .vue лишається unsupported (whole-file шлях) */
}

const QUOTED_NAME_RE = /'([^']{1,80})'|"([^"]{1,80})"/g
// Object-style defineEmits<{ save: [id: number] }> — ключ вимагає tuple-значення
// (`:\s*[`), щоб не ловити label-и всередині tuple (`[id: number]`) як імена подій.
const EMIT_OBJECT_KEY_RE = /([\w$-]{1,80})\s*:\s*\[/g
const EMITS_GENERIC_RE = /defineEmits<([^>]{1,2000})>/
const EMITS_ARRAY_RE = /defineEmits\(\s*\[([^\]]{0,2000})\]/
const EXPOSE_CALL_RE = /defineExpose\s*\(\s*\{([^()]{0,2000})\}\s*\)/
// Провідний ідентифікатор одного елемента defineExpose (`focus`, `...rest`, `b: c`).
const EXPOSE_ITEM_RE = /^(?:\.{3})?([\w$]{1,80})/
// HTML-коментар template: [^>] гарантує зупинку на першому `>` (кінець `-->`).
const HTML_COMMENT_RE = /<!--([^>]{0,300})>/g
const SLOT_NAME_RE = /^[\w-]{1,80}/
const SLOT_LEAD_MARK_RE = /^[:—-]{1,3}/
// Канонічний патерн JSDoc-блоку без зворотного перебору.
const JSDOC_BLOCK_RE = /\/\*\*[^*]*(?:\*(?!\/)[^*]*)*\*\//g
const WORD_RE = /[\w$-]{1,80}/g
// Модифікатори/ключові слова, які стоять між JSDoc-блоком і власне іменем
// (декларації, `(e: '…'`-префікс сигнатури emit-події).
const SKIP_WORDS = new Set(['readonly', 'export', 'async', 'function', 'const', 'class', 'e'])

/**
 * Порожній факт-лист unsupported-фолбеку (peer відсутній / битий SFC / без script).
 * @param {string} relPath шлях файлу
 * @returns {object} факт-лист із `unsupported: true`
 */
function unsupportedFacts(relPath) {
  return { relPath, lang: 'vue', unsupported: true, header: '', exports: [], imports: {}, markers: {} }
}

/**
 * Розбирає SFC і повертає script-блок (`<script setup>` пріоритетно) з дескриптором.
 * @param {string} src вміст `.vue` файлу
 * @param {string} relPath шлях (filename для компілятора)
 * @returns {{ block: object, descriptor: object }|null} блок+дескриптор або null (нема компілятора / битий SFC / нема script)
 */
export function vueScriptBlock(src, relPath) {
  if (!compilerSfc) return null
  let descriptor
  try {
    ;({ descriptor } = compilerSfc.parse(src, { filename: relPath }))
  } catch {
    return null
  }
  const block = descriptor.scriptSetup ?? descriptor.script
  if (!block?.content?.trim()) return null
  return { block, descriptor }
}

/**
 * Мапа «імʼя → JSDoc-опис» для всього script-блоку: кожен JSDoc-блок
 * привʼязується до першого ідентифікатора одразу після нього (interface-member,
 * ключ обʼєкта, декларація function/const для defineExpose-shorthand, сигнатура
 * emit-події). Одна статична регулярка замість динамічних per-name.
 * @param {string} content текст script-блоку
 * @param {(raw: string) => {desc: string}} parseJsDoc парсер JSDoc з extractors
 * @returns {Map<string, string>} імʼя → опис
 */
function jsDocMap(content, parseJsDoc) {
  const map = new Map()
  for (const m of content.matchAll(JSDOC_BLOCK_RE)) {
    const after = content.slice(m.index + m[0].length, m.index + m[0].length + 120)
    for (const w of after.matchAll(WORD_RE)) {
      if (SKIP_WORDS.has(w[0])) continue
      if (!map.has(w[0])) map.set(w[0], parseJsDoc(m[0]).desc)
      break
    }
  }
  return map
}

/**
 * Імена props через `compileScript().bindings` — канонічний резолв і обʼєктної
 * форми, і generic `defineProps<Props>()` з interface у тому ж блоці. Якщо
 * компіляція впала (битий TS/макрос) — props не витягуються (порожній список).
 * @param {object} descriptor SFC-дескриптор
 * @param {string} relPath шлях (id для compileScript)
 * @returns {string[]} імена props
 */
function vuePropNames(descriptor, relPath) {
  try {
    const compiled = compilerSfc.compileScript(descriptor, { id: relPath })
    return Object.entries(compiled.bindings ?? {})
      .filter(([, type]) => type === 'props')
      .map(([name]) => name)
  } catch {
    return []
  }
}

/**
 * Імена подій із defineEmits: масив-форма (`['save']`), function-signature
 * generic (`(e: 'save'): void`) — лапковані літерали; object-style generic
 * (`{ save: [id: number] }`) — ключі з tuple-значенням.
 * @param {string} content текст script-блоку
 * @returns {string[]} імена подій
 */
function vueEmitNames(content) {
  const m = content.match(EMITS_GENERIC_RE) ?? content.match(EMITS_ARRAY_RE)
  if (!m) return []
  const body = m[1]
  const quoted = Array.from(body.matchAll(QUOTED_NAME_RE), q => q[1] ?? q[2])
  if (quoted.length) return [...new Set(quoted)]
  return [...new Set(Array.from(body.matchAll(EMIT_OBJECT_KEY_RE), k => k[1]))]
}

/**
 * Імена публічно виставлених через defineExpose полів (обʼєктна форма).
 * @param {string} content текст script-блоку
 * @returns {string[]} імена exposed-полів
 */
function vueExposeNames(content) {
  const m = content.match(EXPOSE_CALL_RE)
  if (!m) return []
  const names = m[1]
    .split(',')
    .map(item => item.trim().match(EXPOSE_ITEM_RE)?.[1])
    .filter(Boolean)
  return [...new Set(names)]
}

/**
 * Слоти з маркер-коментарів slot у template (імʼя + опційний опис).
 * Розбір двокроковий: спершу HTML-коментарі однією простою регуляркою,
 * далі — плоский JS-парсинг тексту (без складних патернів).
 * @param {string} template текст template-блоку
 * @returns {Array<{name: string, desc: string}>} слоти
 */
function vueSlots(template) {
  const slots = []
  for (const m of template.matchAll(HTML_COMMENT_RE)) {
    // m[1] — вміст до першого `>`, тобто разом із хвостовим `--` від `-->`
    const text = m[1].endsWith('--') ? m[1].slice(0, -2).trim() : m[1].trim()
    if (!text.startsWith('@slot')) continue
    const rest = text.slice('@slot'.length).trim()
    const name = rest.match(SLOT_NAME_RE)?.[0]
    if (!name) continue
    const desc = rest.slice(name.length).trim().replace(SLOT_LEAD_MARK_RE, '').trim()
    slots.push({ name, desc })
  }
  return slots
}

/**
 * Факт-лист для Vue SFC (`<script setup>` пріоритетно): props/emits/expose/слоти
 * як публічний контракт компонента + переюз JS-хелперів (header, imports,
 * markers) над текстом script-блоку — `<template>`/`<style>` у факти не течуть.
 * Без peer `vue`, на битому SFC чи без script-блоку — `unsupported` (whole-file
 * шлях, як до впровадження).
 * @param {string} src вміст `.vue` файлу
 * @param {string} relPath шлях файлу
 * @param {object} h JS-хелпери з extractors (extractFileHeader, extractExports, extractImports, extractInternalSymbols, extractLocalSymbols, extractMarkers, parseJsDoc)
 * @returns {object} факт-лист (`lang: 'vue'`)
 */
export function extractFactsVue(src, relPath, h) {
  const sb = vueScriptBlock(src, relPath)
  if (!sb) return unsupportedFacts(relPath)
  const { block, descriptor } = sb
  const content = block.content
  const docs = jsDocMap(content, h.parseJsDoc)
  const entry = kind => name => ({ name, kind, desc: docs.get(name) ?? '', params: [], ret: '' })

  return {
    relPath,
    lang: 'vue',
    header: h.extractFileHeader(content),
    exports: [
      ...vuePropNames(descriptor, relPath).map(entry('prop')),
      ...vueEmitNames(content).map(entry('emit')),
      ...vueExposeNames(content).map(entry('expose')),
      ...h.extractExports(content)
    ],
    slots: vueSlots(descriptor.template?.content ?? ''),
    imports: h.extractImports(content),
    internalSymbols: h.extractInternalSymbols(content),
    localSymbols: h.extractLocalSymbols(content),
    markers: h.extractMarkers(content)
  }
}

/**
 * Юніт-шар для `.vue`: JS-юніти зі script-блоку з корекцією span-ів на offset
 * блоку в файлі — anchors/CRC мають вказувати на позиції ОРИГІНАЛЬНОГО `.vue`,
 * а не script-фрагмента.
 * @param {string} src вміст `.vue` файлу
 * @param {string} relPath шлях файлу
 * @param {(src: string, relPath: string) => Array<object>|null} unitsJs екстрактор юнітів js/ts
 * @returns {Array<object>|null} юніти або null (нема компілятора / script / не парситься)
 */
export function extractUnitsVue(src, relPath, unitsJs) {
  const sb = vueScriptBlock(src, relPath)
  if (!sb) return null
  const { block } = sb
  // relPath завжди закінчується на .vue (диспетчер викликає лише для нього)
  const pseudoPath = relPath.slice(0, -'.vue'.length) + (block.lang === 'ts' ? '.ts' : '.js')
  const units = unitsJs(block.content, pseudoPath)
  if (!units) return null
  const offset = block.loc.start.offset
  for (const u of units) {
    u.span = { start: u.span.start + offset, end: u.span.end + offset }
  }
  return units
}
