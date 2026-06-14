/** @see ./docs/lint.md */
import { spawnSync } from 'node:child_process'

import { addedLinesByFile } from '../../../scripts/lib/diff-added-lines.mjs'
import { classifyFindings, parseEslint, parseOxlint, renderFindings } from './lint-findings.mjs'

const JS_EXT_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx|vue)$/u

/**
 * Лишає лише js-подібні файли зі списку.
 * @param {string[]} files список шляхів
 * @returns {string[]} підмножина js-подібних
 */
export function filterJsFiles(files) {
  return files.filter(f => JS_EXT_RE.test(f))
}

/**
 * Запуск інструмента (через bunx) зі стрімінгом у термінал.
 * @param {string[]} args аргументи
 * @param {string} cwd корінь
 * @returns {number} exit code
 */
function runInherit(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, stdio: 'inherit' })
  return typeof r.status === 'number' ? r.status : 1
}

/**
 * Авто-фікс-пас: застосовує `--fix`, stdout приглушено (findings перерендеримо
 * класифіковано), stderr — назовні (краші інструмента видимі).
 * @param {string[]} args аргументи
 * @param {string} cwd корінь
 * @returns {number} exit code
 */
function runFix(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] })
  return typeof r.status === 'number' ? r.status : 1
}

/** Запас буфера для json-виводу лінтерів (великі changeset-и > дефолтного ~1MB). */
const JSON_MAX_BUFFER = 64 * 1024 * 1024

/**
 * Репорт-пас: `--format=json`. Повертає exit-код і stdout (щоб відрізнити
 * «чисто/є-порушення» від краху інструмента).
 * @param {string[]} args аргументи
 * @param {string} cwd корінь
 * @returns {{ status: number, stdout: string }} результат
 */
function runJson(args, cwd) {
  const r = spawnSync('bunx', args, { cwd, encoding: 'utf8', maxBuffer: JSON_MAX_BUFFER })
  return { status: typeof r.status === 'number' ? r.status : 1, stdout: r.stdout ?? '' }
}

/**
 * Full-режим (--full): лінт усього проєкту зі стрімінгом і fail-fast (без класифікації).
 * @param {string} cwd корінь
 * @param {boolean} readOnly true → без `--fix` (детект, нуль мутацій — CI)
 * @returns {number} exit code
 */
function lintFullProject(cwd, readOnly) {
  const ox = runInherit(readOnly ? ['oxlint'] : ['oxlint', '--fix'], cwd)
  if (ox !== 0) return ox
  return runInherit(readOnly ? ['eslint', '.'] : ['eslint', '--fix', '.'], cwd)
}

/**
 * Quick-режим: авто-фікс змінених файлів, тоді класифікація лишених findings
 * на introduced / pre-existing (беклог #6/A). Блокування на будь-якому finding.
 * @param {string[]} js js-подібні змінені файли
 * @param {string} cwd корінь
 * @param {boolean} readOnly true → пропустити фікс-пас (детект, нуль мутацій)
 * @returns {number} exit code (0 — чисто; 1 — лишились findings)
 */
function lintChangedClassified(js, cwd, readOnly) {
  // Фікс-пас обох інструментів (послідовно; обидва — щоб репорт показав повну картину).
  // У read-only пропускаємо — лише детект без мутацій (CI / pre-commit).
  if (!readOnly) {
    runFix(['oxlint', '--fix', ...js], cwd)
    runFix(['eslint', '--fix', ...js], cwd)
  }

  // Репорт-пас по ФІНАЛЬНОМУ (пост-фікс) файлу — рядки findings і diff узгоджені.
  const oxRes = runJson(['oxlint', '--format=json', ...js], cwd)
  const esRes = runJson(['eslint', '--format=json', ...js], cwd)
  const ox = parseOxlint(oxRes.stdout)
  const es = parseEslint(esRes.stdout)

  // Краш інструмента (ненульовий exit + непарсабельний json) НЕ можна тихо пропустити
  // як «чисто» — це регресія проти старого fail-fast. Фейлимо явно.
  if ((ox === null && oxRes.status !== 0) || (es === null && esRes.status !== 0)) {
    process.stderr.write('❌ js-lint: інструмент завершився з помилкою (не lint-порушення) — json не розпарсено\n')
    return 1
  }

  const findings = [...(ox ?? []), ...(es ?? [])]
  if (findings.length === 0) return 0

  const classified = classifyFindings(findings, addedLinesByFile(js, cwd), cwd)
  const header = `❌ js-lint: ${findings.length} порушень (introduced ${classified.introduced.length}, pre-existing ${classified.preExisting.length})`
  process.stdout.write(`${header}\n${renderFindings(classified, cwd)}\n`)
  return 1
}

/**
 * Запускає oxlint+eslint. За замовчуванням — з автофіксом; `opts.readOnly` — лише детект.
 * @param {string[] | undefined} files per-file: лише ці файли; undefined: весь проєкт (--full)
 * @param {string} [cwd] корінь репо
 * @param {{ readOnly?: boolean }} [opts] readOnly → без `--fix` (нуль мутацій)
 * @returns {Promise<number>} 0 — OK, ≠0 — порушення
 */
export function lint(files, cwd = process.cwd(), opts = {}) {
  const readOnly = opts.readOnly === true
  if (files === undefined) {
    return Promise.resolve(lintFullProject(cwd, readOnly))
  }
  const js = filterJsFiles(files)
  if (js.length === 0) return Promise.resolve(0)
  return Promise.resolve(lintChangedClassified(js, cwd, readOnly))
}
