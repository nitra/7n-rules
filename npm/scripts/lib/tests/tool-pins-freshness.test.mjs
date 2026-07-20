/**
 * Тест-тригер: закріплені версії зовнішніх CLI-тулів (`tool-pins.json`, `ensure-tool.mjs`)
 * не мають лежати незмінними довше `TOOL_PINS_MAX_AGE_DAYS`. Це не баг у логіці —
 * тест навмисно починає падати з реальним плином часу, коли пін застарів, і є
 * єдиним місцем, що про це нагадує (без нього застарілі пінові версії тихо
 * лежали б роками, і врешті ensureTool ставив би CVE-уразливі/непідтримувані білди).
 *
 * Полагодити червоний тест: `bun npm/scripts/tool-pins-refresh.mjs` (рефрешить версії
 * й `pinnedAt` на сьогодні) — не редагуй `tool-pins.json` вручну.
 */
import { describe, expect, test } from 'vitest'

import { TOOL_PINS_MAX_AGE_DAYS, checkToolPinsFreshness } from '../ensure-tool.mjs'

describe('tool-pins.json — свіжість піна', () => {
  test(`pinnedAt не старіший за ${TOOL_PINS_MAX_AGE_DAYS} днів`, () => {
    const { pinnedAt, ageDays, stale } = checkToolPinsFreshness()
    expect(
      stale,
      `tool-pins.json застарів (${ageDays} днів від ${pinnedAt}) — bun npm/scripts/tool-pins-refresh.mjs`
    ).toBe(false)
  })
})
