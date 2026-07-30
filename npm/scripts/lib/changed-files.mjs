/**
 * Збір змінених файлів для quick-режиму lint-оркестратора.
 *
 * Quick лінтить лише те, що змінено в робочому дереві: tracked-modified + staged
 * (`git diff HEAD`) і нові untracked (`git ls-files --others --exclude-standard`).
 * Видалені файли не повертаються. Поза git-репо або при помилці git — порожній список.
 *
 * Повністю native (C2 фази 3, `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`):
 * порцелян-виклики git, унікалізація й фільтр worktree-чекаутів тепер усередині
 * `rules-core::changed_files` (через `rules-napi`). Цей фасад — лише передача
 * виклику з JS-сигнатурою, без власної git/regex-логіки.
 */
import { readGitPolicy } from './git-policy.mjs'
import { loadNative } from './native.mjs'

/**
 * Relative-posix список змінених + untracked файлів робочого дерева.
 * @param {string} [cwd] корінь репо
 * @returns {string[]} унікальні шляхи (без видалених)
 */
export function collectChangedFiles(cwd = process.cwd()) {
  return loadNative().collectChangedFiles(cwd)
}

/**
 * Визначає git base для scoped-перевірок без зовнішнього runtime-стану.
 * Кандидати — effective Git policy: `baseBranch` + `releaseBranches`, кожна у
 * `origin/` та локальній формах; розгортання policy лишається тут (Р5 спеки
 * `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`). Саме обчислення
 * «найновішого» сумісного merge-base — у native (`rules-core::changed_base`
 * через `rules-napi`, T4 фази 1): захист від stale-ref і вже інтегрованих
 * змін між довгоживучими середовищами перенесено туди без зміни контракту.
 * Якщо жодного ref немає — null, і caller порівнює лише робоче дерево з HEAD.
 * Повернений sha завжди досяжний (це merge-base існуючого ref), тож
 * fail-closed перевірка в `collectChangedFilesSince` не спрацює хибно. Явний
 * `baseRef` (CI: `--base origin/dev` після fetch) вимикає вибір — merge-base
 * рахується лише проти нього.
 * @param {string} [cwd] корінь репо
 * @param {string|null} [baseRef] явний ref бази замість Git policy
 * @returns {string|null} merge-base commit або null
 */
export function resolveChangedBase(cwd = process.cwd(), baseRef = null) {
  const { integrationBranches } = readGitPolicy(cwd)
  const candidates = integrationBranches.flatMap(name => [`origin/${name}`, name])
  return loadNative().resolveChangedBase(cwd, candidates, baseRef ?? null) ?? null
}

/**
 * Список змінених + untracked файлів **відносно базового комміту**.
 *
 * `git diff <base>` (без `..`/`...`, без `HEAD`) порівнює base-комміт із поточним
 * **робочим деревом** — тобто однаково ловить і закомічене від base, і staged, і
 * незакомічені модифікації. Це гарантує однакову поведінку незалежно від того, чи
 * зміни вже закомічені у worktree. Без `base` — fallback на `collectChangedFiles`
 * (робоче дерево vs HEAD).
 *
 * Fail-closed: недосяжний `base` (rebase/force-update/shallow prune) кидає Error
 * замість мовчазного порожнього scope — перевірку й повідомлення робить native.
 * JS-сигнатура `(base, cwd)` — незмінна plugin-поверхня; native очікує
 * `(cwd, base)`, тож порядок розгортається тут.
 * @param {string|null} [base] базовий комміт
 * @param {string} [cwd] корінь репо
 * @returns {string[]} унікальні шляхи (без видалених)
 */
export function collectChangedFilesSince(base, cwd = process.cwd()) {
  return loadNative().collectChangedFilesSince(cwd, base ?? null)
}
