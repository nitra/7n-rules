/** Tests end-to-end SHADOW/publish generation with fully injected parser and LLM transport. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { buildPackageKnowledge } from '../runner.mjs'

const DOMAIN_ID = 'npm:@fixture/orders'

/** Створює one-file domain fixture, який resolver повертає без filesystem scan. */
function domain(root) {
  return {
    id: DOMAIN_ID,
    ecosystem: 'npm',
    name: '@fixture/orders',
    root,
    rootManifest: 'package.json',
    sourceRoot: '.',
    sourceRoots: ['.'],
    excludedSourceRoots: []
  }
}

/** Повертає complete JS extractor або parser failure для atomicity test. */
function extractor({ fails = false } = {}) {
  return {
    id: 'fixture-js',
    apiVersion: 1,
    extensions: ['.mjs'],
    parser: { id: 'fixture', grammarVersion: '1', runtimeVersion: '1' },
    analyzeFile: vi.fn(({ file }) => {
      if (fails) throw new Error('fixture parser failed')
      return {
        ok: true,
        file: { path: file.path, language: 'js', contentHash: file.contentHash },
        units: [
          {
            localId: 'submit',
            qualifiedPath: `${file.path}#submit`,
            kind: 'function',
            name: 'submit',
            visibility: 'public',
            span: { startByte: 0, endByte: Buffer.byteLength(file.content) }
          }
        ],
        edges: [
          {
            kind: 'invokes',
            fromLocalId: 'submit',
            to: { unresolvedSpecifier: 'fixture-transport', opaque: true },
            evidence: [{ span: { startByte: 0, endByte: Buffer.byteLength(file.content) }, role: 'syntax' }]
          }
        ],
        coverage: { requiredUnits: 1, coveredUnits: 1, requiredEdges: 1, coveredEdges: 1, complete: true }
      }
    })
  }
}

/** Відповідає strict claims contract на всі map/reduce items без реального LLM. */
function successfulBatch() {
  return vi.fn((tier, items) =>
    Promise.resolve(
      items.map(item => {
        const nodes = JSON.parse(item.prompt.match(/Required node IDs: (\[[^\n]+\])\./u)[1])
        const edges = JSON.parse(item.prompt.match(/Required edge IDs: (\[[^\n]+\])\./u)[1])
        const evidence = JSON.parse(item.prompt.match(/Allowed evidence IDs: (\[[^\n]+\])\./u)[1])
        return {
          customId: item.customId,
          ok: JSON.stringify({
            claims: nodes.map(subjectId => ({
              subjectId,
              predicate: 'implements',
              value: true,
              evidenceIds: [evidence[0]],
              confidence: 1
            })),
            coveredNodeIds: nodes,
            coveredEdgeIds: edges
          })
        }
      })
    )
  )
}

/** Створює інʼєкції real core pipeline поверх контрольованих domain/adapters/sources. */
function inputs(root, adapter, extra = {}) {
  return {
    repoRoot: root,
    domainId: DOMAIN_ID,
    resolveDomainsImpl: vi.fn(async () => ({ domains: [domain(root)], diagnostics: [] })),
    loadAdaptersImpl: vi.fn(async () => ({ blocked: false, diagnostics: [], adapters: { domain: [], extractor: [adapter] } })),
    loadSourcesImpl: vi.fn(async () => ({ ok: true, sources: [{ path: 'src/orders.mjs', content: 'export function submit() {}' }] })),
    ...extra
  }
}

describe('buildPackageKnowledge', () => {
  test('SHADOW validates and stages candidate, then unchanged cache performs zero LLM calls', async () => {
    await withTmpDir(async root => {
      const cache = { entries: {} }
      const firstBatch = successfulBatch()
      const first = await buildPackageKnowledge(inputs(root, extractor(), { cache, submitBatchImpl: firstBatch }))
      const secondBatch = successfulBatch()
      const second = await buildPackageKnowledge(inputs(root, extractor(), { cache, submitBatchImpl: secondBatch }))

      expect(first).toMatchObject({ ok: true, mode: 'shadow', domainId: DOMAIN_ID })
      expect(firstBatch).toHaveBeenCalledTimes(1)
      expect(second).toMatchObject({ ok: true, mode: 'shadow', domainId: DOMAIN_ID })
      expect(secondBatch).not.toHaveBeenCalled()
      expect(await readFile(join(first.stagingPath, 'docs', '.docgen', 'manifest.json'), 'utf8')).toContain(DOMAIN_ID)
      await expect(readFile(join(root, 'docs', 'index.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  test('parser failure is fail-closed and does not replace existing docs', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs', 'index.md'), 'legacy document\n', 'utf8')
      const batch = successfulBatch()
      const result = await buildPackageKnowledge(inputs(root, extractor({ fails: true }), { submitBatchImpl: batch }))

      expect(result).toMatchObject({ ok: false, stage: 'candidate', diagnostics: [{ code: 'extractor-threw' }] })
      expect(batch).not.toHaveBeenCalled()
      expect(await readFile(join(root, 'docs', 'index.md'), 'utf8')).toBe('legacy document\n')
    })
  })

  test('explicit publish atomically adds generated views and preserves unrelated legacy docs', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(join(root, 'docs', 'legacy.md'), 'keep legacy file documentation\n', 'utf8')
      const result = await buildPackageKnowledge(inputs(root, extractor(), { publish: true, submitBatchImpl: successfulBatch() }))

      expect(result).toMatchObject({ ok: true, mode: 'published', domainId: DOMAIN_ID })
      expect(await readFile(join(root, 'docs', 'legacy.md'), 'utf8')).toBe('keep legacy file documentation\n')
      expect(await readFile(join(root, 'docs', 'index.md'), 'utf8')).toContain('Package knowledge')
      expect(await readFile(join(root, 'docs', '.docgen', 'manifest.json'), 'utf8')).toContain(DOMAIN_ID)
    })
  })
})
