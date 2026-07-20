/** @see ./docs/js-facts.md */

/**
 * JSDoc-коментар (Block, `/** ... *​/`), що стоїть ВПРИТУЛ перед позицією (лише
 * пробіли між ними) — з реального списку коментарів парсера (`comments` від
 * `parseProgramAndCommentsOrNull`), не regex по сирому тексту. Спільна для
 * `extractors.mjs` (експорти js/mjs/ts) і `units-js.mjs` (юніти) — усуває клас
 * false positive, де "/**"-подібний текст трапляється всередині `//`-коментаря
 * чи рядкового літералу (напр. glob `'src/**​/x.rs'` чи `// приклад: /** ... *​/`)
 * — токенізатор там уже коректно визначив межі справжніх коментарів, а
 * regex-сканер такого тексту не бачить окремо і жадібно «протікає» до
 * наступного реального `*​/`, змішуючи проміжний код в опис. Винесена в окремий
 * модуль (без залежностей на `extractors.mjs`/`units-js.mjs`), щоб обидва могли
 * її імпортувати без циклічного імпорту між собою.
 * @param {Array<{type:string, value:string, start:number, end:number}>} comments список коментарів парсера (у порядку файлу)
 * @param {string} src вміст файлу (для перевірки, що проміжок — лише пробіли)
 * @param {number} pos позиція, перед якою шукаємо коментар
 * @returns {string|null} дослівний `/** ... *​/`-текст або null, якщо немає
 */
export function jsDocCommentBefore(comments, src, pos) {
  let best = null
  for (const c of comments) {
    if (c.type !== 'Block' || !c.value.startsWith('*') || c.end > pos) continue
    if (!best || c.end > best.end) best = c
  }
  if (!best || src.slice(best.end, pos).trim() !== '') return null
  return src.slice(best.start, best.end)
}
