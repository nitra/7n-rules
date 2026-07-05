/**
 * Тести T0-фіксера `fix-internal_urls.mjs`: виправлення `service`/`namespace`
 * розбіжностей у `HASURA_GRAPHQL_ENDPOINT`, збереження `cluster`/`port`.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { patterns } from '../fix-internal_urls.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const P = patterns[0]
const ctxFor = dir => ({ cwd: dir, ruleId: 'hasura', concernId: 'internal_urls', files: undefined })

describe('hasura-internal-url-mismatch pattern', () => {
  test('test: спрацьовує лише на mismatch-причини', () => {
    expect(P.test([{ reason: 'internal-url-service-mismatch', message: 'm', file: 'x' }])).toBe(true)
    expect(P.test([{ reason: 'internal-url-namespace-mismatch', message: 'm', file: 'x' }])).toBe(true)
    expect(P.test([{ reason: 'internal-url-invalid', message: 'm', file: 'x' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })

  test('apply: переписує service, зберігаючи namespace/cluster/port', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await mkdir(join(dir, 'hasura', 'k8s', 'base'), { recursive: true })
      await writeFile(
        join(dir, 'hasura', 'k8s', 'base', 'svc-hl.yaml'),
        'apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n',
        'utf8'
      )
      await writeFile(
        join(dir, 'dev.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n',
        'utf8'
      )

      const { violations: before } = await lint(ctxFor(dir))
      expect(before).toHaveLength(1)
      expect(before[0].reason).toBe('internal-url-service-mismatch')

      const res = await P.apply(before, ctxFor(dir))
      expect(res.touchedFiles).toHaveLength(1)

      const content = await readFile(join(dir, 'dev.env'), 'utf8')
      expect(content).toBe('HASURA_GRAPHQL_ENDPOINT=http://order-h.ua-contract.svc.abie-ua.internal:8080\n')

      const { violations: after } = await lint(ctxFor(dir))
      expect(after).toEqual([])
    })
  })

  test('apply: не чіпає структурно невалідний URL (internal-url-invalid)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile(join(dir, 'dev.env'), 'HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n', 'utf8')

      const { violations: before } = await lint(ctxFor(dir))
      expect(before[0].reason).toBe('internal-url-invalid')

      const res = await P.apply(before, ctxFor(dir))
      expect(res.touchedFiles).toEqual([])

      const content = await readFile(join(dir, 'dev.env'), 'utf8')
      expect(content).toBe('HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n')
    })
  })
})
