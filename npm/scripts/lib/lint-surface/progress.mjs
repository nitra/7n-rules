/**
 * Спільний ProgressReporter для довгих lint/fix-прогонів unified lint surface
 * (spec docs/specs/2026-07-03-lint-progress-bar-design.md; канон — scripts.mdc
 * «Прогрес довгих lint/fix-прогонів»).
 *
 * Гібридна одиниця прогресу: монотонний бар по концернах (total відомий з плану
 * детекції) + тикер порушень «знайдено / виправлено». Семантика лічильників
 * «не бреше вниз»: re-detect, що відкрив нові порушення (маскування,
 * standalone-T0), збільшує `found`, а не ховається.
 *
 * TTY-розгалуження авто: isTTY → однорядковий бар (`cli-progress` MultiBar;
 * решта виводу — через обгорнутий `log`, який друкує над баром); не-TTY (CI,
 * hooks, пайпи) → append-only рядок зведення на кожну оброблену одиницю,
 * без ANSI.
 */
import cliProgress from 'cli-progress'

/** Ширина смуги бара в символах. */
const BAR_WIDTH = 20

/**
 * Кастомний formatter (функція, не format-рядок): дефолтний formatter cli-progress
 * тягне CJS `require('string-width')`, який під bun-хойстингом отримує ESM-only v8
 * і падає (`_stringWidth is not a function`). Функція-formatter обходить його повністю.
 * @param {object} options опції бара (barCompleteChar/barIncompleteChar)
 * @param {object} params стан бара (value/total/progress)
 * @param {object} payload наш payload (unitLabel/found/fixed/current/withFixed)
 * @returns {string} готовий рядок бара
 */
function formatBar(options, params, payload) {
  const filled = Math.round(params.progress * BAR_WIDTH)
  const bar = options.barCompleteChar.repeat(filled) + options.barIncompleteChar.repeat(BAR_WIDTH - filled)
  const ticker = payload.withFixed ? ` · знайдено ${payload.found} · виправлено ${payload.fixed}` : ''
  return `[${bar}] ${params.value}/${params.total} ${payload.unitLabel}${ticker} · ${payload.current}`
}

/**
 * @typedef {object} ProgressReporter
 * @property {(s: string) => void} log обгорнутий логер: у TTY друкує над баром, інакше — прямий
 * @property {(label: string, tier?: string) => void} concernStart оновити суфікс поточної одиниці
 * @property {(key: string, count: number) => void} detectSnapshot знімок detect/re-detect (кількість порушень)
 * @property {(key: string) => void} concernDone одиницю оброблено (закриту чи ні) — бар +1
 * @property {() => { done: number, total: number, found: number, fixed: number }} summary поточні лічильники
 * @property {() => void} stop фінальний render і звільнення TTY-рядка
 */

/**
 * Створює reporter. `total` — кількість одиниць (концернів/файлів) з плану.
 * @param {object} opts опції
 * @param {number} opts.total загальна кількість одиниць прогону
 * @param {(s: string) => void} opts.log базовий логер (типово process.stdout.write)
 * @param {boolean} [opts.isTTY] явний override TTY-режиму; типово process.stdout.isTTY
 * @param {string} [opts.unitLabel] підпис одиниці в барі (типово 'концернів')
 * @param {boolean} [opts.withFixed] чи показувати тикер «знайдено/виправлено» (типово true)
 * @returns {ProgressReporter} reporter
 */
export function createProgressReporter(opts) {
  const { total } = opts
  const baseLog = opts.log
  const isTTY = opts.isTTY ?? process.stdout.isTTY === true
  const unitLabel = opts.unitLabel ?? 'концернів'
  const withFixed = opts.withFixed !== false

  /** @type {Map<string, { found: number, remaining: number }>} */
  const counters = new Map()
  let done = 0
  let current = '…'

  /**
   * Пер-ключ стан лічильників (лениве створення).
   * @param {string} key ключ одиниці (`rule/concern` або шлях файлу)
   * @returns {{ found: number, remaining: number }} стан
   */
  function stateFor(key) {
    let s = counters.get(key)
    if (!s) {
      s = { found: 0, remaining: 0 }
      counters.set(key, s)
    }
    return s
  }

  /**
   * Агрегує тикер по всіх ключах.
   * @returns {{ found: number, fixed: number }} суми
   */
  function tally() {
    let found = 0
    let fixed = 0
    for (const s of counters.values()) {
      found += s.found
      fixed += s.found - s.remaining
    }
    return { found, fixed }
  }

  /** @type {import('cli-progress').MultiBar|null} */
  let multibar = null
  /** @type {import('cli-progress').SingleBar|null} */
  let bar = null
  if (isTTY && total > 0) {
    multibar = new cliProgress.MultiBar(
      {
        format: formatBar,
        clearOnComplete: true,
        hideCursor: true,
        barCompleteChar: '█',
        barIncompleteChar: '░'
      },
      cliProgress.Presets.shades_classic
    )
    bar = multibar.create(total, 0, { unitLabel, withFixed, found: 0, fixed: 0, current })
  }

  /** Перемальовує бар актуальним payload-ом (тільки TTY). */
  function redraw() {
    if (!bar) return
    const { found, fixed } = tally()
    bar.update(done, { unitLabel, withFixed, found, fixed, current })
  }

  return {
    log: s => {
      // multibar.log вимагає рядок із \n наприкінці — інакше рве перемальовування.
      if (multibar) multibar.log(s.endsWith('\n') ? s : `${s}\n`)
      else baseLog(s)
    },

    concernStart: (label, tier) => {
      current = tier ? `${label} (${tier})` : label
      redraw()
    },

    detectSnapshot: (key, count) => {
      const s = stateFor(key)
      // found «не бреше вниз»: якщо re-detect показав більше, ніж (remaining + вже
      // зафіксовані виправлення), — found росте (маскування, standalone-T0).
      const fixedPrev = s.found - s.remaining
      s.found = Math.max(s.found, count + fixedPrev)
      s.remaining = count
      redraw()
    },

    concernDone: key => {
      done += 1
      // Одиниця без жодного знімка (порожній концерн) — ключ все одно матеріалізується,
      // щоб summary().found був повним.
      stateFor(key)
      redraw()
      if (!bar) {
        const { found, fixed } = tally()
        const ticker = withFixed ? ` · знайдено ${found} · виправлено ${fixed}` : ''
        baseLog(`  ⏱ ${done}/${total} ${unitLabel}${ticker}\n`)
      }
    },

    summary: () => {
      const { found, fixed } = tally()
      return { done, total, found, fixed }
    },

    stop: () => {
      if (multibar) {
        redraw()
        multibar.stop()
        multibar = null
        bar = null
      }
    }
  }
}
