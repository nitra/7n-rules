import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { publishKnowledgeArtifacts } from '../publish.mjs'
import { zoneHash } from '../zones.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const auto = content =>
  `<!-- AUTOGEN:start id="summary" hash="${zoneHash(content)}" -->${content}<!-- AUTOGEN:end id="summary" -->`

async function seed(root) {
  await mkdir(join(root, 'docs', '.docgen'), { recursive: true })
  await writeFile(
    join(root, 'docs', 'index.md'),
    `intro${auto('old')}<!-- MANUAL:start id="note" -->keep<!-- MANUAL:end id="note" -->`
  )
  await writeFile(join(root, 'docs', '.docgen', 'manifest.json'), '{"old":true}\n')
}

describe('atomic package knowledge publication', () => {
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
})
