import { describe, expect, test } from 'vitest'

import { applyAutogenUpdates, assertProtectedZonesPreserved, parseKnowledgeZones, zoneHash } from '../zones.mjs'

const generated = content =>
  `<!-- AUTOGEN:start id="summary" hash="${zoneHash(content)}" -->${content}<!-- AUTOGEN:end id="summary" -->`

describe('package knowledge zones', () => {
  test('parses paired stable markers and validates AUTOGEN hash', () => {
    const doc = `# Title\n${generated('old')}\n<!-- EXPECTED:start id="expect-save" -->must save<!-- EXPECTED:end id="expect-save" -->`
    expect(parseKnowledgeZones(doc, 'docs/index.md')).toMatchObject({ ok: true })
    expect(parseKnowledgeZones(doc.replace('old', 'edited'), 'docs/index.md')).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'zone-hash-mismatch' })]
    })
  })

  test('rejects unpaired markers and duplicate stable IDs', () => {
    expect(parseKnowledgeZones('<!-- MANUAL:start id="same" -->x', 'docs/x.md')).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'unclosed-zone' })]
    })
    expect(
      parseKnowledgeZones(
        '<!-- MANUAL:start id="same" -->x<!-- MANUAL:end id="same" --><!-- EXPECTED:start id="same" -->y<!-- EXPECTED:end id="same" -->'
      )
    ).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'duplicate-zone-id' })]
    })
  })

  test('fails closed for malformed or unsupported marker declarations', () => {
    expect(parseKnowledgeZones('<!-- AUTOGEN:start id="Not-Stable" -->')).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'invalid-zone-marker' })]
    })
    expect(parseKnowledgeZones('<!-- MERGED:start id="legacy" -->')).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'unsupported-zone-kind' })]
    })
  })

  test('writes only AUTOGEN content and preserves protected zones', () => {
    const doc = `${generated('old')}<!-- MANUAL:start id="note" -->keep<!-- MANUAL:end id="note" -->`
    const updated = applyAutogenUpdates(doc, { summary: 'new' })
    expect(updated).toMatchObject({ ok: true })
    expect(updated.markdown).toContain('keep')
    expect(applyAutogenUpdates(doc, { note: 'replace' })).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'protected-zone-write' })]
    })
  })

  test('detects manual and implicit-manual modifications', () => {
    const previous = `prefix${generated('old')}<!-- EXPECTED:start id="e" -->expected<!-- EXPECTED:end id="e" -->suffix`
    const candidate = `changed${generated('new')}<!-- EXPECTED:start id="e" -->changed<!-- EXPECTED:end id="e" -->suffix`
    expect(assertProtectedZonesPreserved(previous, candidate)).toEqual({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'protected-zone-modified' }),
        expect.objectContaining({ code: 'implicit-manual-modified' })
      ])
    })
  })
})
