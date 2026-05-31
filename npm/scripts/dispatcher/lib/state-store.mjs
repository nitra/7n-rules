/**
 * Crash-safe сховище runtime-стану `flow` (spec §4, §4.1).
 *
 * Локація — **sibling-файл** `.worktrees/<sanitized-branch>.flow.json` поруч із
 * checkout (НЕ всередині нього: файл усередині worktree = untracked у feature-
 * гілці й ризикує потрапити в `git add -A`). Деривація шляху: для checkout-
 * директорії `.worktrees/feat-x` стан → `.worktrees/feat-x.flow.json`.
 *
 * Crash-safety (§4.1):
 *  - **atomic write**: temp на тому ж FS → `fsync` файла → `rename` (атомарна
 *    заміна; частковий запис неможливий);
 *  - **fail-closed на corruption**: нечитабельний/невалідний JSON або несумісний
 *    `schema_version` → throw (не стартуємо новий flow над зіпсованим станом).
 *
 * Усі шляхи — абсолютні (вимога `no-relative-fs-path`).
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { pid } from 'node:process'

import { appendEvent } from './events.mjs'

export const SCHEMA_VERSION = 1

/**
 * Шлях sibling-файла стану для заданого checkout-каталогу worktree.
 * @param {string} worktreeDir абсолютний шлях checkout (напр. `…/.worktrees/feat-x`)
 * @returns {string} абсолютний шлях `…/.worktrees/feat-x.flow.json`
 */
export function flowStatePath(worktreeDir) {
  if (!isAbsolute(worktreeDir)) {
    throw new Error(`flowStatePath: очікується абсолютний шлях (отримано: ${worktreeDir})`)
  }
  return join(dirname(worktreeDir), `${basename(worktreeDir)}.flow.json`)
}

/**
 * fsync файла за абсолютним шляхом (дані на диск до rename).
 * @param {string} path абсолютний шлях
 * @returns {void}
 */
function fsyncPath(path) {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Атомарно записує стан: temp(той самий каталог)+fsync+rename. Додає
 * `schema_version`. Повертає фактично записаний об'єкт.
 * @param {string} statePath абсолютний шлях `.flow.json`
 * @param {object} state стан без `schema_version`
 * @returns {object} записаний об'єкт (зі `schema_version`)
 */
export function writeState(statePath, state) {
  if (!isAbsolute(statePath)) {
    throw new Error(`writeState: очікується абсолютний шлях (отримано: ${statePath})`)
  }
  const dir = dirname(statePath)
  mkdirSync(dir, { recursive: true })
  const payload = { schema_version: SCHEMA_VERSION, ...state }
  const tmp = join(dir, `.${basename(statePath)}.${pid}.${randomBytes(6).toString('hex')}.tmp`)
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  fsyncPath(tmp)
  renameSync(tmp, statePath)
  // best-effort fsync каталогу (durability rename). Не на всіх платформах
  // (Windows кидає EISDIR/EPERM) — тому загорнуто й помилки ігноруємо.
  try {
    fsyncPath(dir)
  } catch {
    /* fsync каталогу недоступний на цій платформі — некритично */
  }
  return payload
}

/**
 * Читає стан. Відсутній файл → null. Пошкоджений JSON або несумісний
 * `schema_version` → throw (**fail-closed**, §4.1.6).
 * @param {string} statePath абсолютний шлях `.flow.json`
 * @returns {object | null} стан або null, якщо файлу нема
 */
export function readState(statePath) {
  if (!isAbsolute(statePath)) {
    throw new Error(`readState: очікується абсолютний шлях (отримано: ${statePath})`)
  }
  if (!existsSync(statePath)) return null
  const raw = readFileSync(statePath, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`readState: пошкоджений стан (невалідний JSON) у ${statePath} — fail-closed`)
  }
  if (typeof parsed !== 'object' || parsed === null || parsed.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `readState: несумісний або пошкоджений schema_version у ${statePath} ` +
        `(очікується ${SCHEMA_VERSION}) — fail-closed`
    )
  }
  return parsed
}

/**
 * Читає стан, застосовує `fn` і атомарно записує результат. Якщо файлу нема —
 * `fn` отримує `{}`.
 * @param {string} statePath абсолютний шлях `.flow.json`
 * @param {(state: object) => object} fn трансформер стану
 * @returns {object} записаний об'єкт
 */
export function updateState(statePath, fn) {
  const current = readState(statePath)
  return writeState(statePath, fn(current ?? {}))
}

/**
 * Видаляє sibling-файл стану (cleanup при `worktree remove` / `flow cancel`).
 * Ідемпотентно (відсутній файл — не помилка).
 * @param {string} statePath абсолютний шлях `.flow.json`
 * @returns {void}
 */
export function removeState(statePath) {
  if (!isAbsolute(statePath)) {
    throw new Error(`removeState: очікується абсолютний шлях (отримано: ${statePath})`)
  }
  rmSync(statePath, { force: true })
}

/**
 * WAL-перехід (§4.1.2): спершу дописує подію в журнал, ТОДІ атомарно змінює
 * статус у snapshot. Якщо запис стану впаде — подія вже durable (журнал —
 * джерело для reconcile при `resume`).
 * @param {{ statePath: string, eventsPath: string }} paths шляхи стану й журналу
 * @param {object} event подія переходу
 * @param {(state: object) => object} stateFn трансформер стану
 * @param {() => number} [now] фабрика часу (ms)
 * @returns {object} записаний стан
 */
export function recordTransition({ statePath, eventsPath }, event, stateFn, now = Date.now) {
  appendEvent(eventsPath, event, now)
  return updateState(statePath, stateFn)
}

/**
 * Прибирає всі runtime-sibling-и worktree: `.flow.json`, `.events.jsonl`,
 * лок-каталог `.flow-lock-<branch>/`. Ідемпотентно. Викликається `flow cancel`
 * і `worktree remove` (інакше sibling-и осиротіють — git їх не чистить).
 * @param {string} worktreeDir абсолютний шлях checkout (`…/.worktrees/feat-x`)
 * @returns {void}
 */
export function cleanupFlowSiblings(worktreeDir) {
  if (!isAbsolute(worktreeDir)) {
    throw new Error(`cleanupFlowSiblings: очікується абсолютний шлях (отримано: ${worktreeDir})`)
  }
  const base = basename(worktreeDir)
  const dir = dirname(worktreeDir)
  rmSync(join(dir, `${base}.flow.json`), { force: true })
  rmSync(join(dir, `${base}.events.jsonl`), { force: true })
  rmSync(join(dir, `.flow-lock-${base}`), { recursive: true, force: true })
}
