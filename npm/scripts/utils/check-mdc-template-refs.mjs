/**
 * Returns list of template/ files that are NOT referenced in <id>.mdc as
 * markdown link targets. Paths returned are relative to ruleDir.
 *
 * @param {string} ruleDir absolute path to npm/rules/<id>/
 * @param {string} ruleId basename (e.g. "security")
 * @returns {Promise<string[]>}
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

async function walkTemplateDirs(ruleDir) {
  const out = []
  for (const kind of ['fix', 'policy']) {
    const kindDir = join(ruleDir, kind)
    if (!existsSync(kindDir)) continue
    for (const concern of await readdir(kindDir)) {
      const tpl = join(kindDir, concern, 'template')
      if (!existsSync(tpl)) continue
      if (!(await stat(tpl)).isDirectory()) continue
      out.push(...(await collectFiles(tpl)))
    }
  }
  return out.map(p => relative(ruleDir, p))
}

async function collectFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collectFiles(full)))
    else out.push(full)
  }
  return out
}

export async function findMissingMdcRefs(ruleDir, ruleId) {
  const mdcPath = join(ruleDir, `${ruleId}.mdc`)
  if (!existsSync(mdcPath)) return []
  const mdc = await readFile(mdcPath, 'utf8')
  const allFiles = await walkTemplateDirs(ruleDir)
  return allFiles.filter(rel => {
    // Match markdown link to ./<rel> or (<rel>) anywhere in the .mdc
    return !mdc.includes(`./${rel}`) && !mdc.includes(`(${rel})`)
  })
}
