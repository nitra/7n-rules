import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { isConcernEnabled, isRuleEnabled, readNRulesConfigLite } from '../read-n-rules-config-lite.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

describe('readNRulesConfigLite', () => {
  test('повертає exists:false коли файл відсутній', async () => {
    await withTmpDir(async dir => {
      const cfg = await readNRulesConfigLite(dir)
      expect(cfg).toEqual({ exists: false, rules: [], disableRules: [] })
    })
  })

  test('повертає rules і disableRules з файлу', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-rules.json'), { rules: ['js', 'docker'], 'disable-rules': ['text'] })
      const cfg = await readNRulesConfigLite(dir)
      expect(cfg.exists).toBe(true)
      expect(cfg.rules).toEqual(['js', 'docker'])
      expect(cfg.disableRules).toEqual(['text'])
    })
  })

  test('повертає порожні масиви коли поля відсутні', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-rules.json'), { name: 'x' })
      const cfg = await readNRulesConfigLite(dir)
      expect(cfg.exists).toBe(true)
      expect(cfg.rules).toEqual([])
      expect(cfg.disableRules).toEqual([])
    })
  })

  test('фільтрує нерядкові елементи з rules', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-rules.json'), '{"rules":["a",42,null,"b"]}', 'utf8')
      const cfg = await readNRulesConfigLite(dir)
      expect(cfg.rules).toEqual(['a', 'b'])
    })
  })
})

describe('isRuleEnabled', () => {
  test('true коли config.exists=false (open by default)', () => {
    expect(isRuleEnabled({ exists: false, rules: [], disableRules: [] }, 'any')).toBe(true)
  })

  test('false коли rule в disableRules', () => {
    expect(isRuleEnabled({ exists: true, rules: ['a'], disableRules: ['a'] }, 'a')).toBe(false)
  })

  test('true коли rule в rules', () => {
    expect(isRuleEnabled({ exists: true, rules: ['a', 'b'], disableRules: [] }, 'a')).toBe(true)
  })

  test('false коли rule не в rules', () => {
    expect(isRuleEnabled({ exists: true, rules: ['b'], disableRules: [] }, 'a')).toBe(false)
  })
})

describe('isConcernEnabled', () => {
  test('false коли весь rule вимкнений (rule-level disable-rules)', () => {
    const config = { exists: true, rules: ['k8s'], disableRules: ['k8s'] }
    expect(isConcernEnabled(config, 'k8s', 'network_policy')).toBe(false)
  })

  test('false коли вимкнений лише цей concern (rule/concern у disable-rules)', () => {
    const config = { exists: true, rules: ['k8s'], disableRules: ['k8s/network_policy'] }
    expect(isConcernEnabled(config, 'k8s', 'network_policy')).toBe(false)
  })

  test('true для іншого concern-у того ж rule, коли вимкнений лише один', () => {
    const config = { exists: true, rules: ['k8s'], disableRules: ['k8s/network_policy'] }
    expect(isConcernEnabled(config, 'k8s', 'manifests')).toBe(true)
  })

  test('true коли rule enabled і жодного часткового вимикання немає', () => {
    const config = { exists: true, rules: ['k8s'], disableRules: [] }
    expect(isConcernEnabled(config, 'k8s', 'manifests')).toBe(true)
  })

  test('true коли config.exists=false (open by default)', () => {
    const config = { exists: false, rules: [], disableRules: [] }
    expect(isConcernEnabled(config, 'k8s', 'manifests')).toBe(true)
  })
})
