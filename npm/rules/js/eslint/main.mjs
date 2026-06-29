/**
 * lint-поверхня js/eslint: oxlint + eslint (per-file або full-project).
 */
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { ESLint } from 'eslint'

import { addedLinesByFile } from '../../../scripts/lib/diff-added-lines.mjs'
import { classifyFindings, eslintResultsToFindings, parseOxlint, renderFindings } from '../lint-findings/main.mjs'

const JS_EXT_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|vue)$/u

export function filterJsFiles(files) {
  return files.filter(f => JS_EXT_RE.test(f))
}

function runOxlint(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, stdio: 'inherit' })
  return typeof r.status === 'number' ? r.status : 1
}

function runOxlintFix(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] })
  return typeof r.status === 'number' ? r.status : 1
}

const JSON_MAX_BUFFER = 64 * 1024 * 1024

function runOxlintJson(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, encoding: 'utf8', maxBuffer: JSON_MAX_BUFFER })
  return { status: typeof r.status === 'number' ? r.status : 1, stdout: r.stdout ?? '' }
}

async function lintFullProject(cwd, readOnly) {
  const ox = runOxlint(readOnly ? ['oxlint'] : ['oxlint', '--fix'], cwd)
  if (ox !== 0) return ox

  const eslint = new ESLint({ fix: !readOnly, cwd })
  let results
  try {
    results = await eslint.lintFiles([cwd])
    if (!readOnly) await ESLint.outputFixes(results)
  } catch (err) {
    process.stderr.write(`❌ js: eslint завершився з помилкою: ${err.message}\n`)
    return 1
  }
  const formatter = await eslint.loadFormatter('stylish')
  const text = await formatter.format(results)
  if (text) process.stdout.write(`${text}\n`)
  return results.some(r => r.errorCount > 0) ? 1 : 0
}

async function lintChangedClassified(js, cwd, readOnly) {
  const absJs = js.map(f => resolve(cwd, f))

  let esResults
  if (readOnly) {
    const eslint = new ESLint({ cwd })
    try {
      esResults = await eslint.lintFiles(absJs)
    } catch (err) {
      process.stderr.write(`❌ js: eslint завершився з помилкою: ${err.message}\n`)
      return 1
    }
  } else {
    runOxlintFix(['oxlint', '--fix', ...js], cwd)
    const eslint = new ESLint({ fix: true, cwd })
    try {
      esResults = await eslint.lintFiles(absJs)
      await ESLint.outputFixes(esResults)
    } catch (err) {
      process.stderr.write(`❌ js: eslint завершився з помилкою: ${err.message}\n`)
      return 1
    }
  }

  const oxRes = runOxlintJson(['oxlint', '--format=json', ...js], cwd)
  const ox = parseOxlint(oxRes.stdout)

  if (ox === null && oxRes.status !== 0) {
    process.stderr.write('❌ js: oxlint завершився з помилкою (не lint-порушення) — json не розпарсено\n')
    return 1
  }

  const es = eslintResultsToFindings(esResults)
  const findings = [...(ox ?? []), ...es]
  if (findings.length === 0) return 0

  const classified = classifyFindings(findings, addedLinesByFile(js, cwd), cwd)
  const header = `❌ js: ${findings.length} порушень (introduced ${classified.introduced.length}, pre-existing ${classified.preExisting.length})`
  process.stdout.write(`${header}\n${renderFindings(classified, cwd)}\n`)
  return 1
}

/**
 * lint-поверхня js/eslint: per-file → oxlint+eslint; full → full-project.
 * @param {string[] | undefined} files per-file або undefined (full)
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean }} [opts]
 * @returns {Promise<number>}
 */
export async function lint(files, cwd = process.cwd(), opts = {}) {
  const readOnly = opts.readOnly === true
  if (files === undefined) return lintFullProject(cwd, readOnly)
  const js = filterJsFiles(files)
  if (js.length === 0) return 0
  return lintChangedClassified(js, cwd, readOnly)
}
