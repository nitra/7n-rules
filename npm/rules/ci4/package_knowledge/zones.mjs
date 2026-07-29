import { createHash } from 'node:crypto'

const MARKER_RE =
  /<!--\s*(AUTOGEN|MANUAL|EXPECTED):(start|end)\s+id="([a-z][a-z0-9-]{0,127})"(?:\s+hash="(sha256:[a-f0-9]{64})")?\s*-->/gu
const ZONE_LIKE_RE = /<!--\s*([A-Z]+):(start|end)\b/gu

/** @param {string} content zone content @returns {string} stable SHA-256 marker value */
export function zoneHash(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

/** @param {string} code machine code @param {string} detail explanation @param {string | null} [path] document path */
function diagnostic(code, detail, path = null) {
  return { code, detail, path }
}

/**
 * Parses strict protected/generated zone markers and validates pairing, global stable IDs and
 * AUTOGEN hashes. Text outside an explicit zone is returned as implicit MANUAL content so a
 * publisher can preserve it byte-for-byte.
 * @param {string} markdown source document
 * @param {string | null} [path] document path for diagnostics
 * @returns {{ ok: true, zones: Array<Record<string, unknown>>, implicitManual: string[] } | { ok: false, diagnostics: Array<Record<string, unknown>> }} parsed zones or failures
 */
export function parseKnowledgeZones(markdown, path = null) {
  if (typeof markdown !== 'string')
    return { ok: false, diagnostics: [diagnostic('invalid-markdown', 'Markdown має бути рядком.', path)] }
  const markers = Array.from(markdown.matchAll(MARKER_RE), match => ({
    kind: match[1],
    action: match[2],
    id: match[3],
    hash: match[4] ?? null,
    start: match.index,
    end: match.index + match[0].length
  }))
  const diagnostics = []
  const validMarkerStarts = new Set(markers.map(marker => marker.start))
  for (const marker of markdown.matchAll(ZONE_LIKE_RE)) {
    if (!['AUTOGEN', 'MANUAL', 'EXPECTED'].includes(marker[1])) {
      diagnostics.push(diagnostic('unsupported-zone-kind', `Zone kind ${marker[1]} не підтримується.`, path))
    } else if (!validMarkerStarts.has(marker.index)) {
      diagnostics.push(
        diagnostic(
          'invalid-zone-marker',
          `Marker ${marker[1]}:${marker[2]} має невалідний stable id або attributes.`,
          path
        )
      )
    }
  }
  const zones = []
  const implicitManual = []
  const ids = new Set()
  let cursor = 0
  let open = null
  for (const marker of markers) {
    if (marker.action === 'start') {
      if (open) {
        diagnostics.push(
          diagnostic('nested-zone', `Zone ${marker.kind}:${marker.id} вкладена в ${open.kind}:${open.id}.`, path)
        )
        continue
      }
      if (ids.has(marker.id))
        diagnostics.push(diagnostic('duplicate-zone-id', `Zone id "${marker.id}" не є stable unique.`, path))
      ids.add(marker.id)
      if (marker.kind === 'AUTOGEN' && marker.hash === null)
        diagnostics.push(diagnostic('missing-zone-hash', `AUTOGEN ${marker.id} не має hash.`, path))
      if (marker.kind !== 'AUTOGEN' && marker.hash !== null)
        diagnostics.push(
          diagnostic('protected-zone-hash', `${marker.kind} ${marker.id} не може мати generated hash.`, path)
        )
      implicitManual.push(markdown.slice(cursor, marker.start))
      open = marker
      continue
    }
    if (marker.hash !== null)
      diagnostics.push(diagnostic('end-zone-hash', `End marker ${marker.id} не може мати hash.`, path))
    if (!open) {
      diagnostics.push(diagnostic('orphan-zone-end', `End marker ${marker.kind}:${marker.id} не має start.`, path))
      continue
    }
    if (open.kind !== marker.kind || open.id !== marker.id) {
      diagnostics.push(
        diagnostic(
          'mismatched-zone-end',
          `Start ${open.kind}:${open.id} не збігається з end ${marker.kind}:${marker.id}.`,
          path
        )
      )
      open = null
      continue
    }
    const content = markdown.slice(open.end, marker.start)
    if (open.kind === 'AUTOGEN' && open.hash !== zoneHash(content)) {
      diagnostics.push(diagnostic('zone-hash-mismatch', `AUTOGEN ${open.id} має змінений content або hash.`, path))
    }
    zones.push({
      kind: open.kind,
      id: open.id,
      hash: open.hash,
      content,
      start: open.start,
      end: marker.end,
      contentStart: open.end,
      contentEnd: marker.start
    })
    cursor = marker.end
    open = null
  }
  if (open) diagnostics.push(diagnostic('unclosed-zone', `Zone ${open.kind}:${open.id} не має end marker.`, path))
  implicitManual.push(markdown.slice(cursor))
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  return { ok: true, zones, implicitManual }
}

/**
 * Applies only declared AUTOGEN replacements and recalculates their hashes. Protected and
 * implicit MANUAL content is never selected as a writable target.
 * @param {string} markdown current document
 * @param {Record<string, string>} updates AUTOGEN id → generated content
 * @param {string | null} [path] diagnostic path
 * @returns {{ ok: true, markdown: string } | { ok: false, diagnostics: Array<Record<string, unknown>> }} updated document or blocking errors
 */
export function applyAutogenUpdates(markdown, updates, path = null) {
  const parsed = parseKnowledgeZones(markdown, path)
  if (!parsed.ok) return parsed
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-autogen-updates', 'Updates має бути object id → string.', path)]
    }
  }
  const byId = new Map(parsed.zones.map(zone => [zone.id, zone]))
  const diagnostics = []
  for (const [id, content] of Object.entries(updates)) {
    const zone = byId.get(id)
    if (!zone) diagnostics.push(diagnostic('unknown-zone-id', `AUTOGEN ${id} не знайдено.`, path))
    else if (zone.kind !== 'AUTOGEN')
      diagnostics.push(
        diagnostic('protected-zone-write', `Не можна generated content записати в ${zone.kind} ${id}.`, path)
      )
    else if (typeof content !== 'string')
      diagnostics.push(diagnostic('invalid-generated-content', `AUTOGEN ${id} має бути рядком.`, path))
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  let result = markdown
  for (const zone of [...parsed.zones].filter(zone => Object.hasOwn(updates, zone.id)).toReversed()) {
    const content = updates[zone.id]
    const start = `<!-- AUTOGEN:start id="${zone.id}" hash="${zoneHash(content)}" -->`
    const end = `<!-- AUTOGEN:end id="${zone.id}" -->`
    result = `${result.slice(0, zone.start)}${start}${content}${end}${result.slice(zone.end)}`
  }
  return { ok: true, markdown: result }
}

/**
 * Verifies that a generated candidate keeps every existing protected/implicit manual byte.
 * @param {string} previous committed markdown
 * @param {string} candidate prospective markdown
 * @param {string | null} [path] document path
 * @returns {{ ok: true } | { ok: false, diagnostics: Array<Record<string, unknown>> }} preservation verdict
 */
export function assertProtectedZonesPreserved(previous, candidate, path = null) {
  const left = parseKnowledgeZones(previous, path)
  const right = parseKnowledgeZones(candidate, path)
  if (!left.ok) return left
  if (!right.ok) return right
  const diagnostics = []
  const oldProtected = left.zones.filter(zone => zone.kind !== 'AUTOGEN')
  const nextById = new Map(right.zones.filter(zone => zone.kind !== 'AUTOGEN').map(zone => [zone.id, zone]))
  for (const zone of oldProtected) {
    const next = nextById.get(zone.id)
    if (!next || next.kind !== zone.kind || next.content !== zone.content) {
      diagnostics.push(
        diagnostic(
          'protected-zone-modified',
          `${zone.kind} ${zone.id} змінено або видалено generated candidate-ом.`,
          path
        )
      )
    }
  }
  if (
    left.implicitManual.length !== right.implicitManual.length ||
    left.implicitManual.some((part, index) => part !== right.implicitManual[index])
  ) {
    diagnostics.push(
      diagnostic('implicit-manual-modified', 'Generated candidate змінив текст поза explicit zones.', path)
    )
  }
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true }
}
