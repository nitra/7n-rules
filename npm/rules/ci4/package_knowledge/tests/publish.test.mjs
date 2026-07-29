import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { publishKnowledgeArtifacts } from '../publish.mjs'
import { zoneHash } from '../zones.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/**
 * Обгортає generated content у valid AUTOGEN markers.
 * @param {string} content generated content
 * @returns {string} marked zone
 */
const auto = (content, id = 'summary') =>
  `<!-- AUTOGEN:start id="${id}" hash="${zoneHash(content)}" -->${content}<!-- AUTOGEN:end id="${id}" -->`

/** Returns a minimal previous package-knowledge manifest for stale-page ownership. */
const knowledgeManifest = () =>
  JSON.stringify({ schemaVersion: 1, domain: { id: 'npm:@fixture/orders' }, nodes: [], topics: [] })

/**
 * Створює committed docs tree перед publication test.
 * @param {string} root domain root
 * @returns {Promise<void>} completes after fixture write
 */
async function seed(root) {
  await mkdir(join(root, 'docs', '.docgen'), { recursive: true })
  await writeFile(
    join(root, 'docs', 'index.md'),
    `intro${auto('old')}<!-- MANUAL:start id="note" -->keep<!-- MANUAL:end id="note" -->`
  )
  await writeFile(join(root, 'docs', '.docgen', 'manifest.json'), '{"old":true}\n')
}

describe('atomic package knowledge publication', () => {
  test('rejects invalid requests before touching the filesystem', async () => {
    await expect(publishKnowledgeArtifacts({ domainRoot: 'relative', files: {} })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: 'invalid-domain-root' }]
    })
    await withTmpDir(async domainRoot => {
      await expect(publishKnowledgeArtifacts({ domainRoot, files: {} })).resolves.toMatchObject({
        ok: false,
        diagnostics: [{ code: 'missing-manifest' }]
      })
      await expect(
        publishKnowledgeArtifacts({
          domainRoot,
          files: { 'docs/.docgen/manifest.json': '{}', '../outside.md': 'no' },
          validate: () => ({ ok: true })
        })
      ).resolves.toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-candidate-file' }] })
      await expect(
        publishKnowledgeArtifacts({ domainRoot, files: { 'docs/.docgen/manifest.json': '{}' } })
      ).resolves.toMatchObject({ ok: false, diagnostics: [{ code: 'missing-validator' }] })
    })
  })

  test('turns validator exceptions into blocking diagnostics', async () => {
    await withTmpDir(async domainRoot => {
      const result = await publishKnowledgeArtifacts({
        domainRoot,
        files: { 'docs/.docgen/manifest.json': '{}' },
        validate: () => {
          throw new Error('validator crash')
        }
      })
      expect(result).toEqual({
        ok: false,
        diagnostics: [{ code: 'caller-validation-threw', detail: 'validator crash' }]
      })
    })
  })

  test('caller validation failure leaves docs and manifest byte-identical', async () => {
    await withTmpDir(async domainRoot => {
      await seed(domainRoot)
      const before = await readFile(join(domainRoot, 'docs', 'index.md'), 'utf8')
      const result = await publishKnowledgeArtifacts({
        domainRoot,
        files: {
          'docs/index.md': `intro${auto('new')}<!-- MANUAL:start id="note" -->keep<!-- MANUAL:end id="note" -->`,
          'docs/.docgen/manifest.json': '{"new":true}\n'
        },
        validate: () => ({ ok: false, diagnostics: [{ code: 'gate' }] })
      })
      expect(result).toMatchObject({ ok: false })
      expect(await readFile(join(domainRoot, 'docs', 'index.md'), 'utf8')).toBe(before)
      expect(await readFile(join(domainRoot, 'docs', '.docgen', 'manifest.json'), 'utf8')).toBe('{"old":true}\n')
    })
  })

  test('publishes through stage only after validation and preserves protected zones', async () => {
    await withTmpDir(async domainRoot => {
      await seed(domainRoot)
      const result = await publishKnowledgeArtifacts({
        domainRoot,
        files: {
          'docs/index.md': `intro${auto('new')}<!-- MANUAL:start id="note" -->keep<!-- MANUAL:end id="note" -->`,
          'docs/.docgen/manifest.json': '{"new":true}\n'
        },
        validate: () => ({ ok: true })
      })
      expect(result).toEqual({ ok: true })
      expect(await readFile(join(domainRoot, 'docs', 'index.md'), 'utf8')).toContain('new')
      expect(await readFile(join(domainRoot, 'docs', '.docgen', 'manifest.json'), 'utf8')).toBe('{"new":true}\n')
    })
  })

  test('protected-zone conflict aborts before replacing committed docs', async () => {
    await withTmpDir(async domainRoot => {
      await seed(domainRoot)
      const result = await publishKnowledgeArtifacts({
        domainRoot,
        files: {
          'docs/index.md': `intro${auto('new')}<!-- MANUAL:start id="note" -->changed<!-- MANUAL:end id="note" -->`,
          'docs/.docgen/manifest.json': '{"new":true}\n'
        },
        validate: () => ({ ok: true })
      })
      expect(result).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'protected-zone-modified' })] })
      expect(await readFile(join(domainRoot, 'docs', 'index.md'), 'utf8')).toContain('keep')
    })
  })

  test('validates markers for a new Markdown artifact', async () => {
    await withTmpDir(async domainRoot => {
      const invalid = await publishKnowledgeArtifacts({
        domainRoot,
        files: {
          'docs/index.md': '<!-- AUTOGEN:start id="summary" -->broken',
          'docs/.docgen/manifest.json': '{}'
        },
        validate: () => ({ ok: true })
      })
      expect(invalid).toMatchObject({ ok: false })

      const valid = await publishKnowledgeArtifacts({
        domainRoot,
        files: {
          'docs/index.md': auto('new'),
          'docs/.docgen/manifest.json': '{"new":true}\n'
        },
        validate: () => ({ ok: true })
      })
      expect(valid).toEqual({ ok: true })
      expect(await readFile(join(domainRoot, 'docs', 'index.md'), 'utf8')).toContain('new')
    })
  })

  test('removes stale canonical generated pages while preserving legacy file docs', async () => {
    await withTmpDir(async domainRoot => {
      await mkdir(join(domainRoot, 'docs', 'explanation', 'processes'), { recursive: true })
      await mkdir(join(domainRoot, 'docs', '.docgen'), { recursive: true })
      await writeFile(join(domainRoot, 'docs', '.docgen', 'manifest.json'), knowledgeManifest(), 'utf8')
      await writeFile(
        join(domainRoot, 'docs', 'explanation', 'processes', 'aaaaaaaaaaaaaaaaaaaaaaaa.md'),
        auto('obsolete process', 'process-aaaaaaaaaaaaaaaaaaaaaaaa'),
        'utf8'
      )
      await writeFile(join(domainRoot, 'docs', 'legacy.md'), 'legacy file documentation\n', 'utf8')

      await expect(
        publishKnowledgeArtifacts({
          domainRoot,
          files: { 'docs/.docgen/manifest.json': knowledgeManifest(), 'docs/index.md': auto('fresh', 'package-index') },
          validate: () => ({ ok: true })
        })
      ).resolves.toEqual({ ok: true })
      await expect(
        readFile(join(domainRoot, 'docs', 'explanation', 'processes', 'aaaaaaaaaaaaaaaaaaaaaaaa.md'), 'utf8')
      ).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(domainRoot, 'docs', 'legacy.md'), 'utf8')).resolves.toBe('legacy file documentation\n')
    })
  })

  test('blocks stale generated removal with protected content and leaves the tree byte-identical', async () => {
    await withTmpDir(async domainRoot => {
      const stalePath = join(domainRoot, 'docs', 'explanation', 'processes', 'bbbbbbbbbbbbbbbbbbbbbbbb.md')
      const stale = `${auto('obsolete process', 'process-bbbbbbbbbbbbbbbbbbbbbbbb')}<!-- MANUAL:start id="migration" -->keep<!-- MANUAL:end id="migration" -->`
      await mkdir(join(domainRoot, 'docs', 'explanation', 'processes'), { recursive: true })
      await mkdir(join(domainRoot, 'docs', '.docgen'), { recursive: true })
      await writeFile(join(domainRoot, 'docs', '.docgen', 'manifest.json'), knowledgeManifest(), 'utf8')
      await writeFile(stalePath, stale, 'utf8')

      const result = await publishKnowledgeArtifacts({
        domainRoot,
        files: { 'docs/.docgen/manifest.json': knowledgeManifest(), 'docs/index.md': auto('fresh', 'package-index') },
        validate: () => ({ ok: true })
      })

      expect(result).toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ code: 'stale-generated-protected' })]
      })
      await expect(readFile(stalePath, 'utf8')).resolves.toBe(stale)
      await expect(readFile(join(domainRoot, 'docs', '.docgen', 'manifest.json'), 'utf8')).resolves.toBe(
        knowledgeManifest()
      )
    })
  })
})
