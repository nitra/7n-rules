/**
 * Тести `zkLogbackRootLevelViolation` — JS-доповнення `k8s.dremio_logging` для
 * `dremio_v2/templates/zookeeper.yaml` (Helm-темплейт, не rego — див. main.mjs).
 */
import { describe, expect, test } from 'vitest'

import { zkLogbackRootLevelViolation } from '../main.mjs'

describe('zkLogbackRootLevelViolation', () => {
  test('немає вбудованого logback.xml — null (не наша справа)', () => {
    const src = 'apiVersion: apps/v1\nkind: StatefulSet\nmetadata:\n  name: zk\n'
    expect(zkLogbackRootLevelViolation(src)).toBeNull()
  })

  test('root level="WARN" — null (валідно)', () => {
    const src = [
      'data:',
      '  logback.xml: |',
      '    <configuration>',
      '      <root level="WARN">',
      '        <appender-ref ref="CONSOLE" />',
      '      </root>',
      '    </configuration>',
      ''
    ].join('\n')
    expect(zkLogbackRootLevelViolation(src)).toBeNull()
  })

  test('root level="ERROR"/"OFF" — теж валідно (строгіше за warn)', () => {
    for (const level of ['ERROR', 'OFF', 'error', 'off']) {
      const src = `data:\n  logback.xml: |\n    <root level="${level}">\n`
      expect(zkLogbackRootLevelViolation(src)).toBeNull()
    }
  })

  test('root level="INFO" — порушення', () => {
    const src = [
      'data:',
      '  logback.xml: |',
      '    <configuration>',
      '      <root level="INFO">',
      '        <appender-ref ref="CONSOLE" />',
      '      </root>',
      '    </configuration>',
      ''
    ].join('\n')
    const v = zkLogbackRootLevelViolation(src)
    expect(v).not.toBeNull()
    expect(v).toContain('INFO')
  })

  test('логер-вміст присутній, але <root> відсутній — порушення', () => {
    const src = 'data:\n  logback.xml: |\n    <configuration>\n      <appender name="CONSOLE" />\n    </configuration>\n'
    const v = zkLogbackRootLevelViolation(src)
    expect(v).not.toBeNull()
    expect(v).toContain('без <root level')
  })

  test('case-insensitive: level="Warn" — валідно', () => {
    const src = 'data:\n  logback.xml: |\n    <root level="Warn">\n'
    expect(zkLogbackRootLevelViolation(src)).toBeNull()
  })
})
