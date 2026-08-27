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
 *
 * Два РІЗНІ випадки «дзеркало без канону» (не змішувати — spec
 * `docs/plans/2026-08-05-open-questions-register.md` §2.42): (1) справді зовнішнє дзеркало —
 * жоден очікуваний плагін тут ні до чого, тихий пропуск легітимний; (2) канон МАВ БИ бути в
 * плагіні, якого `.n-rules.json`/автодетект очікують активним, але який не зарезолвився
 * (не встановлений, несумісний plugin API, битий маніфест) — тут тихий пропуск ХИБНИЙ: він
 * звужує обсяг перевірки й репортить це як «дрейфу нема». Розрізнення — порівняння
 * очікуваного списку плагінів (`resolvePluginList`, конфіг-або-автодетект, без потреби в
 * `node_modules`) із фактично зарезолвленими джерелами (`resolveRulesDirs`): розбіжність =
 * `unresolvedPluginNames`. Дзеркало без власника вважається «зовнішнім» лише коли цей список
 * порожній; інакше — `unresolved: true`, і `findMirrorDrift` кидає помилку замість мовчазного
 * `[]`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { appendDiscoveredMdcFiles, inlineTemplateLinks } from './inline-template-links.mjs'
import { resolveRulesDirs } from './plugin-slots.mjs'
import { readNRulesConfigLite } from './read-n-rules-config-lite.mjs'
import { resolvePluginList } from './resolve-plugins.mjs'

const MIRROR_PREFIX = 'n-'
const MDC_EXT = '.mdc'

/**
 * Rules-джерела репо у порядку пріоритету: ядро, потім `rules.directory@1` contributions
 * АКТИВНИХ плагінів (з `.n-rules.json`, резолв через node_modules — той самий шлях, що у
 * синку; неактивні plugins/* монорепо не враховуються, бо їх нема і в дзеркалах). Разом з тим
 * рахує `unresolvedPluginNames` — плагіни, яких конфіг/автодетект ОЧІКУЮТЬ активними
 * (`resolvePluginList`, чистий предикат без `node_modules`-I/O), але яких немає серед реально
 * зарезолвлених джерел: ознака того, що `rulesDirs` НЕПОВНИЙ (не встановлено, несумісний
 * plugin API, битий маніфест, відсутній `rules.directory`-contribution) — а не що ці плагіни
 * легітимно не потрібні.
 * @param {string} repoRoot корінь репо
 * @returns {Promise<{ rulesDirs: string[], unresolvedPluginNames: string[] }>} джерела й розбіжність
 */
async function repoRulesDirs(repoRoot) {
  const config = await readNRulesConfigLite(repoRoot)
  const pluginsConfig = { plugins: config.plugins }
  const dirs = resolveRulesDirs(repoRoot, pluginsConfig, join(repoRoot, 'npm/rules'), {
    allowInstall: false,
    quiet: true
  })
  // `quiet: true` тут доречний: hot-path без мережевого/console-шуму (той самий сенс, що й
  // раніше), АЛЕ більше не єдине джерело сигналу — розбіжність нижче структурована (масив
  // рядків), а не текстовий warning, який `listManagedMirrors`/`findMirrorDrift` не могли б
  // надійно розпарсити чи навіть побачити (stderr hot-path гука на кожен файл глушиться саме
  // тому, що раніше нікому було його читати).
  const expectedPluginNames = resolvePluginList(repoRoot, pluginsConfig, { quiet: true })
  const resolvedNames = new Set(dirs.map(d => d.name))
  const unresolvedPluginNames = expectedPluginNames.filter(name => !resolvedNames.has(name))
  return { rulesDirs: dirs.map(d => d.rulesDir), unresolvedPluginNames }
}

/**
 * Керовані дзеркала `.cursor/rules/n-<id>.mdc` з канонічним джерелом у ядрі або плагіні.
 * Справді зовнішні дзеркала (без жодного очікуваного плагіна-кандидата) пропускаються.
 * Дзеркала, чий канон мав би бути в незарезолвленому плагіні, лишаються в результаті з
 * `unresolved: true` — це НЕ «зовнішнє», викликач (`findMirrorDrift`) має провалитись голосно,
 * а не мовчки їх відкинути.
 * @param {string} repoRoot корінь репо
 * @returns {Promise<{ id: string, mirrorPath: string, canonicalPath: string, extraDirs: string[], unresolved: boolean, missingPlugins: string[] }[]>} список
 */
export async function listManagedMirrors(repoRoot) {
  const rulesDir = join(repoRoot, '.cursor/rules')
  if (!existsSync(rulesDir)) return []
  const { rulesDirs: sources, unresolvedPluginNames } = await repoRulesDirs(repoRoot)
  return readdirSync(rulesDir)
    .filter(f => f.startsWith(MIRROR_PREFIX) && f.endsWith(MDC_EXT))
    .map(f => {
      const id = f.slice(MIRROR_PREFIX.length, -MDC_EXT.length)
      const candidates = sources.map(s => join(s, id))
      const owner = candidates.find(dir => existsSync(join(dir, `main${MDC_EXT}`)))
      const extraDirs = owner === undefined ? [] : candidates.filter(dir => dir !== owner && existsSync(dir))
      const unresolved = owner === undefined && unresolvedPluginNames.length > 0
      return {
        id,
        mirrorPath: join(rulesDir, f),
        canonicalPath: owner === undefined ? '' : join(owner, `main${MDC_EXT}`),
        extraDirs,
        unresolved,
        missingPlugins: unresolved ? unresolvedPluginNames : []
      }
    })
    .filter(m => m.canonicalPath !== '' || m.unresolved)
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
 *
 * Дзеркала з `unresolved: true` (canon мав би бути в незарезолвленому плагіні, див.
 * {@link listManagedMirrors}) НЕ трактуються як «дрейфу нема» — на них перевірка кидає
 * помилку з поясненням (які дзеркала, які плагіни не резолвляться), а не мовчки звужує обсяг
 * до підмножини, що резолвиться. Дрейф серед дзеркал, які РЕЗОЛВИЛИСЬ, при цьому не
 * приховується — потрапляє в текст помилки, а не губиться разом з rejected-промісом.
 * @param {string} repoRoot корінь репо
 * @returns {Promise<string[]>} відсортовані id дрейфу (коли всі очікувані джерела резолвляться)
 * @throws {Error} коли хоч одне кероване дзеркало без власника — через незарезолвлений плагін
 */
export async function findMirrorDrift(repoRoot) {
  const drift = []
  const unresolvedIds = []
  let missingPlugins = []
  for (const m of await listManagedMirrors(repoRoot)) {
    if (m.unresolved) {
      unresolvedIds.push(m.id)
      missingPlugins = m.missingPlugins
      continue
    }
    const expected = await expectedMirrorContent(m.canonicalPath, m.extraDirs)
    if (readFileSync(m.mirrorPath, 'utf8') !== expected) drift.push(m.id)
  }
  if (unresolvedIds.length > 0) {
    const sortedDrift = drift.toSorted()
    const driftNote = sortedDrift.length > 0 ? ` Дрейф серед резолвлених дзеркал: [${sortedDrift.join(', ')}].` : ''
    throw new Error(
      `mirror-parity: канон дзеркал [${unresolvedIds.toSorted().join(', ')}] не вдалося зарезолвити — ` +
        `очікувані плагіни не зарезолвились: ${missingPlugins.join(', ')}. ` +
        'Постав bun install (або перевір, чи ці плагіни справді потрібні в .n-rules.json#plugins) і повтори.' +
        driftNote
    )
  }
  return drift.toSorted()
}
