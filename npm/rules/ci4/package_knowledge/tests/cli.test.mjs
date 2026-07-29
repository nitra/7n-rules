import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { runDocsCli } from '../cli.mjs'

async function writeDomain(root) {
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/orders', private: true }))
  const manifest = {
    schemaVersion: 1,
    domain: {
      id: 'npm:@fixture/orders',
      ecosystem: 'npm',
      name: '@fixture/orders',
      rootManifest: 'package.json',
      sourceFingerprint: 'sha256:domain'
    },
    nodes: [
      {
        id: 'code-unit:npm:@fixture/orders:js:submitOrder',
        kind: 'code-unit',
        name: 'submitOrder',
        visibility: 'public',
        domainId: 'npm:@fixture/orders',
        attributes: {},
        sourceFingerprint: 'sha256:unit'
      },
      {
        id: 'code-unit:npm:@fixture/orders:js:privateHelper',
        kind: 'code-unit',
        name: 'privateHelper',
        visibility: 'private',
        domainId: 'npm:@fixture/orders',
        attributes: {},
        sourceFingerprint: 'sha256:private'
      }
    ],
    edges: [],
    claims: [
      {
        id: 'claim:submit',
        subjectId: 'code-unit:npm:@fixture/orders:js:submitOrder',
        layer: 'implemented',
        predicate: 'produces',
        value: 'order',
        evidenceIds: ['evidence:submit'],
        confidence: 1,
        sourceFingerprint: 'sha256:claim'
      }
    ],
    topics: [
      {
        id: 'process:order-submit',
        kind: 'process',
        title: 'Submit order',
        domainId: 'npm:@fixture/orders',
        anchorIds: ['code-unit:npm:@fixture/orders:js:submitOrder'],
        aliases: ['process:legacy-submit']
      }
    ],
    gaps: [],
    evidence: [
      {
        id: 'evidence:submit',
        kind: 'code',
        path: 'src/submit.mjs',
        symbolId: 'code-unit:npm:@fixture/orders:js:privateHelper',
        span: { startByte: 0, endByte: 10 },
        contentHash: 'sha256:evidence',
        role: 'syntax'
      }
    ]
  }
  const manifestDir = join(root, 'docs', '.docgen')
  await mkdir(manifestDir, { recursive: true })
  await writeFile(join(manifestDir, 'manifest.json'), JSON.stringify(manifest))
}

async function captureRun(root, args) {
  const out = []
  const err = []
  const code = await runDocsCli(args, {
    repoRoot: root,
    stdout: line => out.push(line),
    stderr: line => err.push(line)
  })
  return { code, out, err }
}

describe('runDocsCli', () => {
  test('lists portable package domains without absolute runtime roots', async () => {
    await withTmpDir(async root => {
      await writeDomain(root)
      const result = await captureRun(root, ['domains'])

      expect(result.code).toBe(0)
      expect(JSON.parse(result.out[0])).toEqual({
        domains: [
          {
            id: 'npm:@fixture/orders',
            ecosystem: 'npm',
            name: '@fixture/orders',
            rootManifest: 'package.json',
            sourceRoots: ['.'],
            excludedSourceRoots: []
          }
        ],
        diagnostics: []
      })
      expect(result.out[0]).not.toContain(root)
    })
  })

  test('returns a compact index and validates the owning manifest', async () => {
    await withTmpDir(async root => {
      await writeDomain(root)
      const indexed = await captureRun(root, ['index', '--domain', 'npm:@fixture/orders'])
      const validated = await captureRun(root, ['validate', '--domain', 'npm:@fixture/orders'])

      expect(indexed.code).toBe(0)
      expect(JSON.parse(indexed.out[0])).toMatchObject({
        domain: { id: 'npm:@fixture/orders' },
        topics: [{ id: 'process:order-submit' }],
        gapsByStatus: { satisfied: 0, missing: 0, diverged: 0, unresolved: 0 }
      })
      expect(validated.code).toBe(0)
      expect(JSON.parse(validated.out[0])).toMatchObject({ ok: true, domainId: 'npm:@fixture/orders' })
    })
  })

  test('returns a slice without leaking private symbol IDs', async () => {
    await withTmpDir(async root => {
      await writeDomain(root)
      const result = await captureRun(root, [
        'slice',
        '--domain',
        'npm:@fixture/orders',
        '--topic',
        'process:legacy-submit'
      ])

      expect(result.code).toBe(0)
      const slice = JSON.parse(result.out[0])
      expect(slice.topic.id).toBe('process:order-submit')
      expect(slice.nodes).toHaveLength(1)
      expect(slice.evidence).toEqual([
        {
          id: 'evidence:submit',
          kind: 'code',
          path: 'src/submit.mjs',
          span: { startByte: 0, endByte: 10 },
          contentHash: 'sha256:evidence',
          role: 'syntax'
        }
      ])
      expect(result.out[0]).not.toContain('privateHelper')
    })
  })

  test('fails explicitly for missing manifest and invalid command', async () => {
    await withTmpDir(async root => {
      await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@fixture/orders', private: true }))
      const missing = await captureRun(root, ['validate', '--domain', 'npm:@fixture/orders'])
      const invalid = await captureRun(root, ['rebuild'])

      expect(missing.code).toBe(1)
      expect(JSON.parse(missing.err[0])).toMatchObject({ code: 'manifest-unavailable' })
      expect(invalid.code).toBe(1)
      expect(JSON.parse(invalid.err[0])).toMatchObject({ code: 'unknown-docs-command' })
    })
  })

  test('does not mutate a committed manifest during any read command', async () => {
    await withTmpDir(async root => {
      await writeDomain(root)
      const path = join(root, 'docs', '.docgen', 'manifest.json')
      const before = await readFile(path, 'utf8')

      await captureRun(root, ['domains'])
      await captureRun(root, ['index', '--domain', 'npm:@fixture/orders'])
      await captureRun(root, ['slice', '--domain', 'npm:@fixture/orders', '--topic', 'process:order-submit'])
      await captureRun(root, ['validate', '--domain', 'npm:@fixture/orders'])

      expect(await readFile(path, 'utf8')).toBe(before)
    })
  })
})
