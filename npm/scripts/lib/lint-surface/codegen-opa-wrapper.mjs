/**
 * Build-time codegen detector-обгорток для policy-concern-ів (spec 2026-06-29 §Policy Codegen).
 *
 * Policy-concern не пише boilerplate `main.mjs` вручну — він генерується з
 * `concern.json` + `{concern}.rego` / `template/`. Generated файл несе `source-hash`
 * у заголовку; drift-gate регенерує його, якщо джерело змінилось.
 *
 * Escape-hatch: якщо `main.mjs` існує БЕЗ `@generated`-заголовка — це ручний detector,
 * codegen його не чіпає.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readConcernMeta } from '../concern-meta.mjs'

/** Версія codegen-шаблону — входить у source-hash, щоб зміна шаблону тригерила регенерацію. */
export const CODEGEN_VERSION = '1'

const GENERATED_MARK = '// @generated — do not edit'
const ADAPTER_ABS = fileURLToPath(new URL('policy-lint-adapter.mjs', import.meta.url))

/**
 * @param {string} content вміст main.mjs
 * @returns {boolean} чи це згенерований (а не ручний) файл
 */
export function isGeneratedFile(content) {
  return content.startsWith(GENERATED_MARK)
}

/**
 * Чи policy.files резолвиться у конкретні таргети (single або walkGlob).
 * Концерни без цього — або orchestrated parent-концерном (rego-бібліотека), або
 * incomplete; standalone detector для них генерувати НЕ можна (кидав би на resolve).
 * @param {object|undefined} files
 * @returns {boolean}
 */
export function hasResolvableFiles(files) {
  if (!files || typeof files !== 'object') return false
  return typeof files.single === 'string' || files.walkGlob !== undefined
}

/**
 * Збирає всі source-входи concern-а у відсортований масив [шлях, вміст] для хешу.
 * @param {string} concernDir
 * @param {string} concernName
 * @returns {Array<[string, string]>}
 */
function collectSources(concernDir, concernName) {
  /** @type {Array<[string, string]>} */
  const parts = []
  const concernJson = join(concernDir, 'concern.json')
  if (existsSync(concernJson)) parts.push(['concern.json', readFileSync(concernJson, 'utf8')])
  const rego = join(concernDir, `${concernName}.rego`)
  if (existsSync(rego)) parts.push([`${concernName}.rego`, readFileSync(rego, 'utf8')])
  const tmplDir = join(concernDir, 'template')
  if (existsSync(tmplDir) && statSync(tmplDir).isDirectory()) {
    for (const name of readdirSync(tmplDir).toSorted()) {
      const p = join(tmplDir, name)
      if (statSync(p).isFile()) parts.push([`template/${name}`, readFileSync(p, 'utf8')])
    }
  }
  return parts
}

/**
 * source-hash = sha256(CODEGEN_VERSION + усі sources). Детермінований.
 * @param {string} concernDir
 * @param {string} concernName
 * @returns {string}
 */
export function computeSourceHash(concernDir, concernName) {
  const h = createHash('sha256')
  h.update(`v${CODEGEN_VERSION}\n`)
  for (const [name, content] of collectSources(concernDir, concernName)) {
    h.update(`--- ${name} ---\n`)
    h.update(content)
  }
  return h.digest('hex').slice(0, 16)
}

/**
 * Рендерить вміст generated main.mjs.
 * @param {object} args
 * @param {'rego'|'template'} args.engine
 * @param {object} args.files policy.files
 * @param {string} [args.missingMessage]
 * @param {string} args.adapterImport relative import до policy-lint-adapter.mjs
 * @param {string} args.hash source-hash
 * @returns {string}
 */
export function renderWrapper({ engine, files, missingMessage, adapterImport, hash }) {
  const cfgLines = [
    `    engine: ${JSON.stringify(engine)},`,
    '    policyDir: import.meta.dirname,',
    `    files: ${JSON.stringify(files)}`
  ]
  if (missingMessage) cfgLines[cfgLines.length - 1] += ','
  if (missingMessage) cfgLines.push(`    missingMessage: ${JSON.stringify(missingMessage)}`)
  return [
    GENERATED_MARK,
    `// source-hash: ${hash}`,
    '/* eslint-disable */',
    `import { evaluatePolicyConcern } from '${adapterImport}'`,
    '',
    "/** @param {import('" + adapterImport.replace('policy-lint-adapter.mjs', 'types.mjs') + "').LintContext} ctx */",
    'export async function lint(ctx) {',
    '  return evaluatePolicyConcern(ctx, {',
    ...cfgLines,
    '  })',
    '}',
    ''
  ].join('\n')
}

/**
 * Генерує/оновлює main.mjs для одного policy-concern-а.
 * @param {string} concernDir
 * @param {string} concernName
 * @returns {Promise<{ action: 'written'|'manual'|'fresh'|'skip', hash?: string }>}
 *   written — записано/оновлено; manual — є ручний main.mjs (не чіпаємо); fresh — hash збігся;
 *   skip — concern без policy-поверхні.
 */
export async function generatePolicyWrapper(concernDir, concernName) {
  const meta = await readConcernMeta(concernDir, concernName)
  if (!meta || !meta.policy) return { action: 'skip' }
  // Incomplete/orchestrated policy (нема single/walkGlob) — не standalone detector.
  if (!hasResolvableFiles(meta.policy.files)) return { action: 'skip' }

  const mainPath = join(concernDir, 'main.mjs')
  if (existsSync(mainPath) && !isGeneratedFile(readFileSync(mainPath, 'utf8'))) {
    return { action: 'manual' }
  }

  const hash = computeSourceHash(concernDir, concernName)
  if (existsSync(mainPath)) {
    const cur = readFileSync(mainPath, 'utf8')
    if (cur.includes(`// source-hash: ${hash}`)) return { action: 'fresh', hash }
  }

  const adapterImport = relative(concernDir, ADAPTER_ABS).split('\\').join('/')
  const content = renderWrapper({
    engine: meta.policy.engine,
    files: meta.policy.files,
    missingMessage: meta.policy.missingMessage,
    adapterImport,
    hash
  })
  writeFileSync(mainPath, content, 'utf8')
  return { action: 'written', hash }
}

/**
 * Drift-gate по всіх policy-concern-ах у `rulesDir`.
 * @param {string} rulesDir
 * @param {object} [opts]
 * @param {boolean} [opts.fix] true → регенерувати stale; false → лише репорт
 * @returns {Promise<{ stale: Array<{ ruleId: string, concernId: string, reason: string }>, regenerated: string[] }>}
 */
export async function checkRegoCodegen(rulesDir, opts = {}) {
  const fix = opts.fix === true
  const { readdir } = await import('node:fs/promises')
  /** @type {Array<{ ruleId: string, concernId: string, reason: string }>} */
  const stale = []
  const regenerated = []
  let ruleEntries
  try {
    ruleEntries = await readdir(rulesDir, { withFileTypes: true })
  } catch {
    return { stale, regenerated }
  }
  for (const ruleEnt of ruleEntries) {
    if (!ruleEnt.isDirectory() || ruleEnt.name.startsWith('.')) continue
    const ruleDir = join(rulesDir, ruleEnt.name)
    let concernEntries
    try {
      concernEntries = await readdir(ruleDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const cEnt of concernEntries) {
      if (!cEnt.isDirectory() || cEnt.name.startsWith('.')) continue
      const concernDir = join(ruleDir, cEnt.name)
      const meta = await readConcernMeta(concernDir, cEnt.name)
      if (!meta || !meta.policy) continue
      if (!hasResolvableFiles(meta.policy.files)) continue // orchestrated/incomplete — не standalone

      const mainPath = join(concernDir, 'main.mjs')
      if (existsSync(mainPath) && !isGeneratedFile(readFileSync(mainPath, 'utf8'))) continue // ручний — escape-hatch

      const hash = computeSourceHash(concernDir, cEnt.name)
      const fresh = existsSync(mainPath) && readFileSync(mainPath, 'utf8').includes(`// source-hash: ${hash}`)
      if (fresh) continue

      if (fix) {
        await generatePolicyWrapper(concernDir, cEnt.name)
        regenerated.push(`${ruleEnt.name}/${cEnt.name}`)
      } else {
        stale.push({
          ruleId: ruleEnt.name,
          concernId: cEnt.name,
          reason: existsSync(mainPath) ? 'policy-codegen-stale' : 'policy-codegen-missing'
        })
      }
    }
  }
  return { stale, regenerated }
}
