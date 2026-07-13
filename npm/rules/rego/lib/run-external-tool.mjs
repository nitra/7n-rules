/**
 * Спільна логіка для read-only rego-детекторів (`opa_check`, `regal`) — обидва per-file:
 * приймають `ctx.files` (конкретні `.rego`), інакше `FULL_TARGET` (весь policy-корінь, якщо
 * існує). Виділено зі спільного дубльованого коду (jscpd) обох `main.mjs`.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

/** Full-режим (ctx.files undefined): корінь policy-дерева, якщо існує. */
export const FULL_TARGET = 'npm/rules'

/** Розширення `.rego` — фільтр delta-списку файлів у `lint(ctx)`. */
export const REGO_EXT_RE = /\.rego$/u

/** Суфікс тест-файлу — для виводу сусіднього policy-файла в delta-цілях. */
const TEST_SUFFIX_RE = /_test\.rego$/u

/**
 * Цілі для прогону: delta-список `.rego`-файлів, або (full-режим) корінь policy-дерева,
 * якщо він існує.
 * @param {string[]|undefined} files `ctx.files` (undefined — full-режим).
 * @param {string} root абсолютний корінь репозиторію.
 * @returns {string[]} цілі для CLI-аргументів інструменту (можливо порожній список).
 */
export function resolveTargets(files, root) {
  if (files === undefined) return existsSync(resolve(root, FULL_TARGET)) ? [FULL_TARGET] : []
  const rego = files.filter(f => REGO_EXT_RE.test(f))
  // `X_test.rego` імпортує сусідній `X.rego`: без нього regal флагує unresolved-import,
  // тож до delta-цілей додаємо наявний сусідній policy-файл.
  const out = new Set(rego)
  for (const f of rego) {
    const sibling = f.replace(TEST_SUFFIX_RE, '.rego')
    if (sibling !== f && existsSync(resolve(root, sibling))) out.add(sibling)
  }
  return [...out]
}

/**
 * Запускає один крок зовнішнього тула, повертає { status, output }.
 * @param {string} bin абсолютний шлях до бінарника
 * @param {string[]} args аргументи
 * @param {string} cwd робоча директорія
 * @returns {{ status: number, output: string }} код завершення й обрізаний stdout+stderr
 */
export function runStep(bin, args, cwd) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', env: process.env, shell: false })
  if (result.error) {
    return { status: 1, output: `Не вдалося запустити ${bin}: ${result.error.message}` }
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 2000)
  return { status: result.status ?? 1, output }
}
