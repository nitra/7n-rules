/**
 * WAL — append-only журнал подій `flow` (spec §4.1.2, §9).
 *
 * Sibling-файл `.worktrees/<sanitized-branch>.events.jsonl` (JSON Lines). Єдиний
 * журнал: субсумує і переходи стану (`step_*`, `blocked`…), і api-облік
 * (`api_call`). Append-only → краш-безпечніший за перезапис: торваний останній
 * рядок (краш посеред append) при читанні **толеруємо** (пропускаємо), а не
 * валимо весь журнал.
 *
 * **WAL-інваріант** (забезпечує `state-store.recordTransition`): подію
 * дописуємо ДО зміни високорівневого статусу у snapshot `.flow.json`.
 *
 * Усі шляхи — абсолютні (`no-relative-fs-path`).
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

/**
 * Шлях sibling-журналу подій для checkout-каталогу worktree.
 * @param {string} worktreeDir абсолютний шлях checkout (`…/.worktrees/feat-x`)
 * @returns {string} `…/.worktrees/feat-x.events.jsonl`
 */
export function flowEventsPath(worktreeDir) {
  if (!isAbsolute(worktreeDir)) {
    throw new Error(`flowEventsPath: очікується абсолютний шлях (отримано: ${worktreeDir})`)
  }
  return join(dirname(worktreeDir), `${basename(worktreeDir)}.events.jsonl`)
}

/**
 * Дописує одну подію (з міткою часу `at`) у журнал. Створює файл за потреби.
 * @param {string} eventsPath абсолютний шлях `.events.jsonl`
 * @param {object} event подія (напр. `{ type: 'step_started', step: 2 }`)
 * @param {() => number} [now] фабрика часу (ms) — ін'єкція для тестів
 * @returns {object} фактично записаний запис (зі `at`)
 */
export function appendEvent(eventsPath, event, now = Date.now) {
  if (!isAbsolute(eventsPath)) {
    throw new Error(`appendEvent: очікується абсолютний шлях (отримано: ${eventsPath})`)
  }
  const record = { at: new Date(now()).toISOString(), ...event }
  appendFileSync(eventsPath, `${JSON.stringify(record)}\n`, 'utf8')
  return record
}

/**
 * Читає всі події. Відсутній файл → `[]`. Непарсабельні рядки (порожні або
 * торваний останній) **пропускаються** (append-only толерантність).
 * @param {string} eventsPath абсолютний шлях `.events.jsonl`
 * @returns {object[]} розпарсені події у порядку запису
 */
export function readEvents(eventsPath) {
  if (!isAbsolute(eventsPath)) {
    throw new Error(`readEvents: очікується абсолютний шлях (отримано: ${eventsPath})`)
  }
  if (!existsSync(eventsPath)) return []
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .flatMap(line => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}
