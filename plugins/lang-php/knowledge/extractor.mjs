/**
 * Будує fail-closed normalized fragments для PHP package-knowledge через php-parser AST.
 * Regex і brace-scanner не беруть участі у production semantic extraction.
 */

import { Buffer } from 'node:buffer'

import PhpParser from 'php-parser'

// cspell:ignore usegroup propertylookup staticlookup
const EXTENSIONS = Object.freeze(['.php'])
const PARSER = Object.freeze({ id: 'php-parser', grammarVersion: 'php-8.3', runtimeVersion: 'php-parser-3.7.0' })

/**
 * Створює fail-closed extractor result.
 * @param {string} code diagnostic code
 * @param {string | null} path source path
 * @param {string} detail diagnostic detail
 * @returns {{ok: false, diagnostics: Array<Record<string, unknown>>}} failure
 */
function failure(code, path, detail) {
  return { ok: false, diagnostics: [{ code, path, detail }] }
}

/**
 * Перетворює parser offset на UTF-8 byte offset.
 * @param {string} content source content
 * @param {number} offset parser offset
 * @returns {number} byte offset
 */
function byteOffset(content, offset) {
  return Buffer.byteLength(content.slice(0, offset), 'utf8')
}

/**
 * Створює half-open UTF-8 span.
 * @param {string} content source content
 * @param {Record<string, unknown>} node PHP AST node
 * @returns {{startByte: number, endByte: number}} byte span
 */
function span(content, node) {
  return { startByte: byteOffset(content, node.loc.start.offset), endByte: byteOffset(content, node.loc.end.offset) }
}

/**
 * Нормалізує parser name node.
 * @param {unknown} node name value
 * @returns {string | null} name
 */
function nodeName(node) {
  if (typeof node === 'string') return node
  return typeof node?.name === 'string' ? node.name : null
}

/**
 * Обходить PHP AST без повторного обходу location metadata.
 * @param {unknown} value current AST value
 * @param {(node: Record<string, unknown>) => void} callback visitor
 * @returns {void}
 */
function visit(value, callback) {
  if (!value || typeof value !== 'object') return
  if (typeof value.kind === 'string') callback(value)
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) visit(item, callback)
    } else if (child && typeof child === 'object' && child !== value.loc) {
      visit(child, callback)
    }
  }
}

/**
 * Збирає parser-derived use bindings.
 * @param {Record<string, unknown>} ast PHP program AST
 * @param {string} content source content
 * @returns {{imports: Array<Record<string, unknown>>, bindings: Map<string, string>}} import index
 */
function importIndex(ast, content) {
  const imports = []
  const bindings = new Map()
  visit(ast, node => {
    if (node.kind !== 'usegroup') return
    for (const item of node.items ?? []) {
      const target = node.name ? `${node.name}\\${item.name}` : item.name
      const local = item.alias ?? target.split('\\').at(-1)
      bindings.set(local, target)
      imports.push({
        specifier: target,
        bindings: [{ localName: local, importedName: target }],
        span: span(content, item)
      })
    }
  })
  return { imports, bindings }
}

/**
 * Збирає declarations і methods як semantic units.
 * @param {Record<string, unknown>} ast PHP program AST
 * @param {string} filePath source path
 * @param {string} content source content
 * @returns {Array<Record<string, unknown>>} semantic units
 */
function collectUnits(ast, filePath, content) {
  const units = []
  const add = (node, name, kind, visibility, qualifiedPath, owner = null) => {
    if (!name || !node.loc) return
    units.push({
      localId: `unit:${qualifiedPath}`,
      kind,
      name,
      qualifiedPath: `${filePath}#${qualifiedPath}`,
      visibility,
      signature: name,
      span: span(content, node),
      ast: node,
      owner
    })
  }
  const walkStatements = (nodes, namespace = '') => {
    for (const node of nodes ?? []) {
      if (node.kind === 'namespace') {
        walkStatements(node.children, node.name ?? '')
        continue
      }
      if (node.kind === 'function') {
        const name = nodeName(node.name)
        add(node, name, 'function', 'public', namespace ? `${namespace}\\${name}` : name)
        continue
      }
      if (!['class', 'interface', 'trait', 'enum'].includes(node.kind)) continue
      const className = nodeName(node.name)
      if (!className) continue
      const qualifiedClass = namespace ? `${namespace}\\${className}` : className
      add(node, className, node.kind, 'public', qualifiedClass, qualifiedClass)
      for (const member of node.body ?? []) {
        if (member.kind !== 'method') continue
        const methodName = nodeName(member.name)
        add(
          member,
          methodName,
          'method',
          member.visibility ?? 'public',
          `${qualifiedClass}::${methodName}`,
          qualifiedClass
        )
      }
    }
  }
  walkStatements(ast.children)
  return units
}

/**
 * Розпізнає local, method або external call target.
 * @param {Record<string, unknown>} call call AST node
 * @returns {Record<string, unknown> | null} normalized target
 */
function callTarget(call) {
  const what = call.what
  if (what?.kind === 'name') return { localName: what.name, externalName: what.name }
  if (what?.kind === 'propertylookup' && what.what?.kind === 'variable' && what.what.name === 'this') {
    return { methodName: nodeName(what.offset) }
  }
  if (what?.kind === 'staticlookup' && what.what?.kind === 'name') return { externalName: what.what.name }
  return null
}

/**
 * Перевіряє, чи unit може містити executable calls.
 * @param {Record<string, unknown>} unit semantic unit
 * @returns {boolean} true для function або method
 */
function isCallableUnit(unit) {
  return unit.kind === 'function' || unit.kind === 'method'
}

/**
 * Будує evidence-backed local та integration call edges.
 * @param {Array<Record<string, unknown>>} units semantic units
 * @param {Map<string, string>} imports imported binding index
 * @param {string} filePath source path
 * @param {string} content source content
 * @returns {Array<Record<string, unknown>>} stable edges
 */
function collectEdges(units, imports, filePath, content) {
  const functions = new Map(units.filter(unit => unit.kind === 'function').map(unit => [unit.name, unit.localId]))
  const methods = new Map(
    units.filter(unit => unit.kind === 'method').map(unit => [`${unit.owner}::${unit.name}`, unit.localId])
  )
  const edges = []
  for (const unit of units) {
    if (!isCallableUnit(unit)) continue
    visit(unit.ast.body, node => {
      if (node.kind !== 'call') return
      const target = callTarget(node)
      if (!target) return
      const evidence = [{ path: filePath, role: 'syntax', span: span(content, node) }]
      const localId = target.methodName
        ? methods.get(`${unit.owner}::${target.methodName}`)
        : functions.get(target.localName)
      if (localId && localId !== unit.localId) {
        edges.push({ kind: 'invokes', fromLocalId: unit.localId, to: { localId }, evidence })
        return
      }
      const imported = imports.get(target.externalName)
      if (imported) {
        edges.push({
          kind: 'integrates',
          fromLocalId: unit.localId,
          to: { unresolvedSpecifier: imported, opaque: true },
          evidence
        })
      }
    })
  }
  return edges.toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

/**
 * Валідує normalized file input і extension.
 * @param {unknown} input extractor input
 * @returns {{ok: true, file: Record<string, unknown>} | {ok: false, result: Record<string, unknown>}} checked input
 */
function readFileInput(input) {
  const file = input?.file
  if (
    !file ||
    typeof file.path !== 'string' ||
    typeof file.content !== 'string' ||
    typeof file.contentHash !== 'string'
  ) {
    return { ok: false, result: failure('invalid-file-input', null, 'file має містити path, content і contentHash.') }
  }
  if (!file.path.toLowerCase().endsWith('.php')) {
    return {
      ok: false,
      result: failure('unsupported-extension', file.path, `PHP knowledge extractor не підтримує ${file.path}.`)
    }
  }
  return { ok: true, file }
}

/**
 * Аналізує PHP source через повний parser та повертає only-complete semantic fragment.
 * @param {Record<string, unknown>} input knowledge extractor input
 * @returns {Record<string, unknown>} complete fragment або blocking result
 */
export function analyzeFile(input) {
  const read = readFileInput(input)
  if (!read.ok) return read.result
  if (input.signal?.aborted) return failure('analysis-aborted', read.file.path, 'Аналіз source-файлу скасовано.')
  let ast
  try {
    ast = new PhpParser({
      parser: { php7: true, version: '8.3', extractDoc: true },
      ast: { withPositions: true }
    }).parseCode(read.file.content, read.file.path)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return failure('parse-error', read.file.path, `PHP parser не зміг повністю розпарсити source-файл: ${detail}`)
  }
  if (!ast?.loc || !Array.isArray(ast.children) || (ast.errors?.length ?? 0) > 0) {
    return failure('parse-error', read.file.path, 'PHP parser повернув неповний AST або syntax diagnostics.')
  }
  const unitsWithAst = collectUnits(ast, read.file.path, read.file.content)
  const { imports, bindings } = importIndex(ast, read.file.content)
  const edges = collectEdges(unitsWithAst, bindings, read.file.path, read.file.content)
  const units = unitsWithAst.map(({ ast: _ast, owner: _owner, ...unit }) => unit)
  return {
    ok: true,
    parser: PARSER,
    file: { ...read.file, language: 'php' },
    units,
    edges,
    imports,
    entryPoints: units
      .filter(unit => unit.visibility === 'public')
      .map(unit => ({ localId: unit.localId, reason: 'public-api' })),
    chunks: units.map(unit => ({ id: `chunk:${unit.localId}`, unitLocalIds: [unit.localId], span: unit.span })),
    coverage: {
      requiredUnits: units.length,
      coveredUnits: units.length,
      requiredEdges: edges.length,
      coveredEdges: edges.length,
      complete: true
    }
  }
}

const phpKnowledgeExtractor = Object.freeze({
  id: 'knowledge-php',
  apiVersion: 1,
  extensions: EXTENSIONS,
  parser: PARSER,
  analyzeFile
})

/** Експортує PHP full-parser adapter для knowledge.extractor@1. */
export default phpKnowledgeExtractor
