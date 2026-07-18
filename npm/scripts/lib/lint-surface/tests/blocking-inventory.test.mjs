/**
 * Guard-тест ADR 260716-1354: `SERIAL_LANE_CONCERNS` (`../blocking-inventory.mjs`) має точно
 * відповідати реальному стану коду — жоден активний concern зі `spawnSync`/`execSync` (прямо
 * чи через відомий blocking-helper) не повинен опинитись поза інвентарем (інакше `detectAll()`
 * тихо заявив би паралелізм там, де він ілюзорний), і жоден мігрований concern не повинен
 * лишатись у списку зайво (інакше serial lane даремно душить уже безпечний детектор).
 */
import { describe, expect, test } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_RULES_DIR } from '../run-detectors.mjs'
import { hasResolvableFiles, isGeneratedFile } from '../codegen-opa-wrapper.mjs'
import { isSerialLane, SERIAL_LANE_CONCERNS } from '../blocking-inventory.mjs'

const BLOCKING_CALL_RE = /\b(?:spawnSync|execSync|execFileSync)\s*\(/
const KNOWN_BLOCKING_HELPER_IMPORT_RE = /\/(?:docker-hadolint|run-external-tool)\.mjs['"]/

/**
 * @param {string} concernJsonPath абсолютний шлях до `concern.json`
 * @returns {boolean} true — concern активний (має `lint`, або `policy` з резолвним `files`)
 */
function isActiveConcern(concernJsonPath) {
  let raw
  try {
    raw = JSON.parse(readFileSync(concernJsonPath, 'utf8'))
  } catch {
    return false
  }
  return raw.lint !== undefined || (raw.policy && hasResolvableFiles(raw.policy.files))
}

/**
 * @param {string} mainPath абсолютний шлях до `main.mjs` concern-а
 * @returns {boolean} true — hand-written main.mjs реально блокує event loop
 */
function isBlockingMain(mainPath) {
  if (!existsSync(mainPath)) return false
  const content = readFileSync(mainPath, 'utf8')
  if (isGeneratedFile(content)) return false
  return BLOCKING_CALL_RE.test(content) || KNOWN_BLOCKING_HELPER_IMPORT_RE.test(content)
}

/**
 * @param {string} ruleDir абсолютний шлях до каталогу правила
 * @param {string} ruleId id правила (basename `ruleDir`)
 * @returns {string[]} blocking concern-и цього правила (`${ruleId}/${concernId}`)
 */
function scanRuleDir(ruleDir, ruleId) {
  const blocking = []
  for (const concernEntry of readdirSync(ruleDir, { withFileTypes: true })) {
    if (!concernEntry.isDirectory()) continue
    const concernDir = join(ruleDir, concernEntry.name)
    const concernJsonPath = join(concernDir, 'concern.json')
    if (!existsSync(concernJsonPath) || !isActiveConcern(concernJsonPath)) continue
    if (isBlockingMain(join(concernDir, 'main.mjs'))) {
      blocking.push(`${ruleId}/${concernEntry.name}`)
    }
  }
  return blocking
}

/**
 * Сканує `DEFAULT_RULES_DIR` і повертає `${ruleId}/${concernId}` для кожного активного
 * (lint- або policy-) concern-а з hand-written (не-`@generated`) `main.mjs`, що реально
 * блокує event loop — прямим `spawnSync`/`execSync` або відомим blocking-helper-ом.
 * @returns {string[]} знайдені blocking concern-и
 */
function scanBlockingConcerns() {
  return readdirSync(DEFAULT_RULES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .flatMap(e => scanRuleDir(join(DEFAULT_RULES_DIR, e.name), e.name))
}

describe('blocking-inventory guard', () => {
  test('SERIAL_LANE_CONCERNS точно відповідає реальному spawnSync/execSync-скану активних concern-ів', () => {
    const found = scanBlockingConcerns().toSorted()
    const declared = [...SERIAL_LANE_CONCERNS].toSorted()
    expect(found).toEqual(declared)
  })

  test('isSerialLane узгоджений із SERIAL_LANE_CONCERNS', () => {
    expect(isSerialLane('rego', 'conftest_verify')).toBe(true)
    expect(isSerialLane('docker', 'lint')).toBe(true)
    expect(isSerialLane('js', 'knip')).toBe(false)
    expect(isSerialLane('nonexistent-rule', 'nonexistent-concern')).toBe(false)
  })
})
