/**
 * Parity дзеркала правил: `.cursor/rules/n-<id>.mdc` має дорівнювати канонічному
 * `main.mdc` правила з inlined-шаблонами — тим самим трансформом, що його
 * застосовує синк (`readBundledRuleContent` → `inlineTemplateLinks` → mixin-extras).
 * Дрейф виникає, коли канонічний `.mdc` змінюють, не регенерувавши дзеркало.
 *
 * Multi-dir: власник правила шукається у `npm/rules/<id>` і `plugins/<p>/rules/<id>`
 * (перший з `main.mdc`); решта тек `rules/<id>` інших джерел — mixin-extras, їхні
 * concern-mdc доінлайнюються після концернів власника (як у синку).
 *
 * Використовується і тестом-гардом (drift === []), і разовою регенерацією.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { appendDiscoveredMdcFiles, inlineTemplateLinks } from './inline-template-links.mjs'
import { resolveRulesDirs } from './plugin-slots.mjs'
import { readNRulesConfigLite } from './read-n-rules-config-lite.mjs'

const MIRROR_PREFIX = 'n-'
const MDC_EXT = '.mdc'

/**
 * Rules-джерела репо у порядку пріоритету: ядро, потім `rules.directory@1` contributions
 * АКТИВНИХ плагінів (з `.n-rules.json`, резолв через node_modules — той самий шлях, що у
 * синку; неактивні plugins/* монорепо не враховуються, бо їх нема і в дзеркалах).
 * @param {string} repoRoot корінь репо
 * @returns {Promise<string[]>} абсолютні шляхи rules-каталогів
 */
async function repoRulesDirs(repoRoot) {
  const config = await readNRulesConfigLite(repoRoot)
  const dirs = resolveRulesDirs(repoRoot, { plugins: config.plugins }, join(repoRoot, 'npm/rules'), {
    allowInstall: false,
    quiet: true
  })
  return dirs.map(d => d.rulesDir)
}

/**
 * Керовані дзеркала `.cursor/rules/n-<id>.mdc` з канонічним джерелом у ядрі або плагіні.
 * Дзеркала без канону (зовнішні) пропускаються.
 * @param {string} repoRoot корінь репо
 * @returns {Promise<{ id: string, mirrorPath: string, canonicalPath: string, extraDirs: string[] }[]>} список
 */
export async function listManagedMirrors(repoRoot) {
  const rulesDir = join(repoRoot, '.cursor/rules')
  if (!existsSync(rulesDir)) return []
  const sources = await repoRulesDirs(repoRoot)
  return readdirSync(rulesDir)
    .filter(f => f.startsWith(MIRROR_PREFIX) && f.endsWith(MDC_EXT))
    .map(f => {
      const id = f.slice(MIRROR_PREFIX.length, -MDC_EXT.length)
      const candidates = sources.map(s => join(s, id))
      const owner = candidates.find(dir => existsSync(join(dir, `main${MDC_EXT}`)))
      const extraDirs = owner === undefined ? [] : candidates.filter(dir => dir !== owner && existsSync(dir))
      return {
        id,
        mirrorPath: join(rulesDir, f),
        canonicalPath: owner === undefined ? '' : join(owner, `main${MDC_EXT}`),
        extraDirs
      }
    })
    .filter(m => m.canonicalPath !== '')
}

/**
 * Очікуваний вміст дзеркала = канон з inlined-шаблонами + concern-mdc mixin-джерел
 * (той самий трансформ, що у синку).
 * @param {string} canonicalPath абсолютний шлях `rules/<id>/main.mdc` власника
 * @param {string[]} [extraDirs] теки `rules/<id>` mixin-джерел
 * @returns {Promise<string>} очікуваний текст дзеркала
 */
export async function expectedMirrorContent(canonicalPath, extraDirs = []) {
  const dir = dirname(canonicalPath)
  let out = await inlineTemplateLinks(readFileSync(canonicalPath, 'utf8'), dir)
  out = await appendDiscoveredMdcFiles(out, dir)
  for (const extra of extraDirs) {
    out = await appendDiscoveredMdcFiles(out, extra)
  }
  return out
}

/**
 * Id дзеркал, що розійшлися з каноном (actual ≠ expected).
 * @param {string} repoRoot корінь репо
 * @returns {Promise<string[]>} відсортовані id дрейфу
 */
export async function findMirrorDrift(repoRoot) {
  const drift = []
  for (const m of await listManagedMirrors(repoRoot)) {
    const expected = await expectedMirrorContent(m.canonicalPath, m.extraDirs)
    if (readFileSync(m.mirrorPath, 'utf8') !== expected) drift.push(m.id)
  }
  return drift.toSorted()
}
