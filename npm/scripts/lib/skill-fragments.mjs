/**
 * Фрагменти SKILL.md від плагінів (Фаза 2, spec
 * 2026-07-27-universal-plugin-slots-lang-php-extraction — переведено на slot bus, §5.1.9).
 *
 * Плагін декларує contribution слоту `skills.fragment@1` (`id` = skillId, `resource` →
 * власний `skills/<skillId>/SKILL.fragment.md` — власну секцію скіла, напр. Rust-гілку taze).
 * Під час синку скіла ядро доклеює фрагменти АКТИВНИХ contributions до скопійованого
 * `SKILL.md` між стабільними маркерами — ре-синк ідемпотентний: наявний блок замінюється
 * повністю, без активних фрагментів — видаляється. Так мовні знання їдуть разом із кодом
 * плагіна, а не сиротіють у ядрі.
 */
import { readFileSync } from 'node:fs'

import { getSlotContributions } from './plugin-slots.mjs'

/** Маркер початку блоку плагінних фрагментів (стабільний). */
export const FRAGMENTS_START = '<!-- n-rules:plugin-fragments:start -->'
/** Маркер кінця блоку плагінних фрагментів. */
export const FRAGMENTS_END = '<!-- n-rules:plugin-fragments:end -->'

/**
 * Збирає фрагменти скіла зі slot graph (у порядку графа — resolved plugin order → manifest
 * order). Contribution `id` слоту `skills.fragment@1` — це і є `skillId` (envelope вимагає
 * рівно одне з `resource`/`value`, тож окремого поля для skillId у payload нема, spec §5.2).
 * @param {string} skillId id скіла без префікса (напр. `taze`)
 * @param {import('./plugin-slots.mjs').SlotGraph} graph граф від `resolveSlotGraph`
 * @returns {Array<{ pluginName: string, content: string }>} знайдені фрагменти
 */
export function collectSkillFragments(skillId, graph) {
  const out = []
  for (const c of getSlotContributions(graph, 'skills.fragment', [1])) {
    if (c.id !== skillId || c.resourcePath === null) continue
    const content = readFileSync(c.resourcePath, 'utf8').trim()
    if (content !== '') out.push({ pluginName: c.pluginName, content })
  }
  return out
}

/**
 * Вшиває блок фрагментів у текст SKILL.md (перед фінальним переносом рядка).
 * Наявний блок між маркерами замінюється; порожній список фрагментів — блок
 * прибирається зовсім.
 * @param {string} content текст SKILL.md
 * @param {Array<{ pluginName: string, content: string }>} fragments зібрані фрагменти
 * @returns {string} текст із актуальним блоком фрагментів
 */
export function injectSkillFragments(content, fragments) {
  const startIdx = content.indexOf(FRAGMENTS_START)
  const endIdx = content.indexOf(FRAGMENTS_END)
  let base = content
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    base = content.slice(0, startIdx) + content.slice(endIdx + FRAGMENTS_END.length)
    base = `${base.trimEnd()}\n`
  }
  if (fragments.length === 0) return base

  const parts = fragments.map(
    f => `<!-- n-rules:plugin:${f.pluginName}:start -->\n\n${f.content}\n\n<!-- n-rules:plugin:${f.pluginName}:end -->`
  )
  const block = `${FRAGMENTS_START}\n\n${parts.join('\n\n')}\n\n${FRAGMENTS_END}`
  return `${base.trimEnd()}\n\n${block}\n`
}
