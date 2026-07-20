/**
 * Фрагменти SKILL.md від плагінів (фаза 4b spec lang-plugins-extraction).
 *
 * Плагін шипить конвенційний файл `skills/<skillId>/SKILL.fragment.md` —
 * власну секцію скіла (напр. Rust-гілку taze). Під час синку скіла ядро
 * доклеює фрагменти АКТИВНИХ плагінів до скопійованого `SKILL.md` між
 * стабільними маркерами — ре-синк ідемпотентний: наявний блок замінюється
 * повністю, без активних фрагментів — видаляється. Так мовні знання їдуть
 * разом із кодом плагіна, а не сиротіють у ядрі.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Маркер початку блоку плагінних фрагментів (стабільний). */
export const FRAGMENTS_START = '<!-- n-rules:plugin-fragments:start -->'
/** Маркер кінця блоку плагінних фрагментів. */
export const FRAGMENTS_END = '<!-- n-rules:plugin-fragments:end -->'

/**
 * Збирає фрагменти скіла з активних плагінів (у порядку списку плагінів).
 * @param {string} skillId id скіла без префікса (напр. `taze`)
 * @param {Array<{ name: string, packageRoot: string }>} plugins активні плагіни (з `resolvePlugins`)
 * @returns {Array<{ pluginName: string, content: string }>} знайдені фрагменти
 */
export function collectSkillFragments(skillId, plugins) {
  const out = []
  for (const plugin of plugins) {
    const fragmentPath = join(plugin.packageRoot, 'skills', skillId, 'SKILL.fragment.md')
    if (!existsSync(fragmentPath)) continue
    const content = readFileSync(fragmentPath, 'utf8').trim()
    if (content !== '') out.push({ pluginName: plugin.name, content })
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
