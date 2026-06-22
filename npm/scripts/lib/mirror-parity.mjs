/**
 * Parity дзеркала правил: `.cursor/rules/n-<id>.mdc` має дорівнювати канонічному
 * `npm/rules/<id>/<id>.mdc` з inlined-шаблонами — тим самим трансформом, що його
 * застосовує синк (`readBundledRuleContent` → `inlineTemplateLinks`). Дрейф виникає,
 * коли канонічний `.mdc` змінюють, не регенерувавши дзеркало (беклог адаптації flow #10).
 *
 * Використовується і тестом-гардом (drift === []), і разовою регенерацією.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { inlineMarkdownIncludes, inlineTemplateLinks } from './inline-template-links.mjs'

const MIRROR_PREFIX = 'n-'
const MDC_EXT = '.mdc'

/**
 * Керовані дзеркала `.cursor/rules/n-<id>.mdc`, що мають канонічне джерело
 * `npm/rules/<id>/<id>.mdc`. Дзеркала без канону (зовнішні) пропускаються.
 * @param {string} repoRoot корінь репо
 * @returns {{ id: string, mirrorPath: string, canonicalPath: string }[]} список
 */
export function listManagedMirrors(repoRoot) {
  const rulesDir = join(repoRoot, '.cursor/rules')
  if (!existsSync(rulesDir)) return []
  return readdirSync(rulesDir)
    .filter(f => f.startsWith(MIRROR_PREFIX) && f.endsWith(MDC_EXT))
    .map(f => {
      const id = f.slice(MIRROR_PREFIX.length, -MDC_EXT.length)
      return {
        id,
        mirrorPath: join(rulesDir, f),
        canonicalPath: join(repoRoot, 'npm/rules', id, `main${MDC_EXT}`)
      }
    })
    .filter(m => existsSync(m.canonicalPath))
}

/**
 * Очікуваний вміст дзеркала = канон з inlined-шаблонами (трансформ синку).
 * @param {string} canonicalPath абсолютний шлях `npm/rules/<id>/<id>.mdc`
 * @returns {Promise<string>} очікуваний текст дзеркала
 */
export async function expectedMirrorContent(canonicalPath) {
  const dir = dirname(canonicalPath)
  const withTemplates = await inlineTemplateLinks(readFileSync(canonicalPath, 'utf8'), dir)
  return inlineMarkdownIncludes(withTemplates, dir)
}

/**
 * Id дзеркал, що розійшлися з каноном (actual ≠ expected).
 * @param {string} repoRoot корінь репо
 * @returns {Promise<string[]>} відсортовані id дрейфу
 */
export async function findMirrorDrift(repoRoot) {
  const drift = []
  for (const m of listManagedMirrors(repoRoot)) {
    const expected = await expectedMirrorContent(m.canonicalPath)
    if (readFileSync(m.mirrorPath, 'utf8') !== expected) drift.push(m.id)
  }
  return drift.toSorted()
}
