import { Buffer } from 'node:buffer'

import { describe, expect, test } from 'vitest'

import { buildNormalizedGraph } from '../../../../npm/rules/ci4/package_knowledge/normalized-graph.mjs'
import phpKnowledgeExtractor, { analyzeFile } from '../extractor.mjs'

function input(path, content) {
  return { domain: { id: 'composer:fixture/php' }, file: { path, content, contentHash: `hash:${path}` } }
}

describe('knowledge.extractor@1 PHP adapter', () => {
  test('declares the full PHP parser contract and its only extension', () => {
    expect(phpKnowledgeExtractor).toMatchObject({ id: 'knowledge-php', apiVersion: 1, parser: { id: 'php-parser', grammarVersion: 'php-8.3' } })
    expect(phpKnowledgeExtractor.extensions).toEqual(['.php'])
  })

  test('extracts public/private units, imports, calls, chunks and complete UTF-8 coverage', () => {
    const content = `<?php\nnamespace App;\nuse Vendor\\Client;\nfinal class Заказ {\n  private function helper() { return Client::go(); }\n  public function save(string $value) { return $this->helper(); }\n}\nfunction run() { return save('x'); }\nfunction save(string $value) { return $value; }\n`
    const result = analyzeFile(input('src/Заказ.php', content))
    expect(result).toMatchObject({ ok: true, file: { language: 'php' } })
    expect(result.units.map(unit => [unit.name, unit.visibility])).toEqual([
      ['Заказ', 'public'], ['helper', 'private'], ['save', 'public'], ['run', 'public'], ['save', 'public']
    ])
    expect(result.units[0].span.startByte).toBe(Buffer.byteLength(content.slice(0, content.indexOf('final class')), 'utf8'))
    expect(result.imports).toEqual([expect.objectContaining({ specifier: 'Vendor\\Client' })])
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'integrates', fromLocalId: 'unit:App\\Заказ::helper', to: { unresolvedSpecifier: 'Vendor\\Client', opaque: true } }),
      expect.objectContaining({ kind: 'invokes', fromLocalId: 'unit:App\\Заказ::save', to: { localId: 'unit:App\\Заказ::helper' } }),
      expect.objectContaining({ kind: 'invokes', fromLocalId: 'unit:App\\run', to: { localId: 'unit:App\\save' } })
    ]))
    expect(result.coverage).toMatchObject({ requiredUnits: 5, coveredUnits: 5, requiredEdges: 3, coveredEdges: 3, complete: true })
    expect(buildNormalizedGraph({ domain: { id: 'composer:fixture/php', ecosystem: 'composer', name: 'fixture/php', rootManifest: 'composer.json' }, fragments: [result] }).ok).toBe(true)
  })

  test('malformed syntax blocks publication without partial graph or fallback', () => {
    const result = analyzeFile(input('src/Broken.php', '<?php function broken( {'))
    expect(result).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'parse-error', path: 'src/Broken.php' })] })
    expect(result).not.toHaveProperty('units')
  })

  test('unsupported file extension is a structured blocking diagnostic', () => {
    expect(analyzeFile(input('src/Nope.phtml', '<?php echo 1;'))).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'unsupported-extension' })] })
  })
})
