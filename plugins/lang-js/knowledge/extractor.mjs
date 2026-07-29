/**
 * Будує fail-closed normalized fragments для JS/TS/Vue package-knowledge.
 *
 * Adapter використовує OXC для всіх script-файлів та existing `vueScriptBlock`
 * для SFC. Він не має whole-file fallback: помилка parser-а або template, для
 * якого ще не реалізовано semantic edges, повертає blocking diagnostic.
 */

import { Buffer } from 'node:buffer'

import { parseProgramAndCommentsOrNull, walkAstWithAncestors } from '@7n/rules/scripts/utils/ast-scan-utils.mjs'
import { vueScriptBlock } from '../doc-files/vue.mjs'

const EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.vue'])
const PARSER = Object.freeze({ id: 'oxc+vue-sfc', grammarVersion: 'oxc-0.137.0', runtimeVersion: 'vue-sfc-3' })

/**
 * Повертає повністю structured blocking result без неповного fragment-а.
 * @param {string} code machine-readable diagnostic code
 * @param {string | null} path repo-relative path source-файлу
 * @param {string} detail пояснення для користувача
 * @returns {{ ok: false, diagnostics: Array<{ code: string, path: string | null, detail: string }> }} failure result
 */
function failure(code, path, detail) {
  return { ok: false, diagnostics: [{ code, path, detail }] }
}

/**
 * Перетворює OXC UTF-16 offset у UTF-8 byte offset оригінального файла.
 * @param {string} original повний content файла
 * @param {number} charOffset offset у code units оригінального файла
 * @returns {number} UTF-8 byte offset
 */
function byteOffset(original, charOffset) {
  return Buffer.byteLength(original.slice(0, charOffset), 'utf8')
}

/**
 * Створює source span у UTF-8 bytes; `baseOffset` потрібен для Vue script-блоку.
 * @param {string} original повний content файла
 * @param {number} start AST offset у script source
 * @param {number} end AST offset у script source
 * @param {number} baseOffset UTF-16 offset початку script у оригіналі
 * @returns {{ startByte: number, endByte: number }} byte span
 */
function span(original, start, end, baseOffset) {
  return {
    startByte: byteOffset(original, baseOffset + start),
    endByte: byteOffset(original, baseOffset + end)
  }
}

/**
 * Визначає language label fragment-а за фактичним extension файла.
 * @param {string} path repo-relative path
 * @returns {string} language id
 */
function languageFromPath(path) {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (extension === '.mjs' || extension === '.cjs') return 'js'
  return extension.slice(1)
}

/**
 * Повертає top-level unit declarations для одного Program node.
 * @param {Record<string, unknown>} node top-level AST node
 * @returns {{ declaration: Record<string, unknown>, exported: boolean }[]} declaration-и
 */
function declarationsFromTopLevel(node) {
  const declaration =
    (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') && node.declaration
      ? node.declaration
      : node
  if (!declaration || typeof declaration !== 'object') return []
  return [
    {
      declaration: /** @type {Record<string, unknown>} */ (declaration),
      exported: node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'
    }
  ]
}

/**
 * Створює semantic units для top-level function/class та function-valued const.
 * @param {Record<string, unknown>} program OXC Program
 * @param {string} filePath source path для qualifiedPath
 * @param {string} original повний file content
 * @param {number} baseOffset offset script у full content
 * @returns {Array<Record<string, unknown>>} units у source order
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- OXC declaration variants share one deterministic source-order pass
function collectUnits(program, filePath, original, baseOffset) {
  const units = []
  const names = new Map()
  for (const node of program.body ?? []) {
    for (const { declaration, exported } of declarationsFromTopLevel(node)) {
      if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
        const name = declaration.id?.name ?? (exported ? 'default' : null)
        if (!name) continue
        const ordinal = names.get(name) ?? 0
        names.set(name, ordinal + 1)
        units.push({
          localId: `unit:${name}:${ordinal}`,
          kind: declaration.type === 'ClassDeclaration' ? 'class' : 'function',
          name,
          qualifiedPath: `${filePath}#${name}`,
          visibility: exported ? 'public' : 'private',
          signature: name,
          span: span(original, declaration.start, declaration.end, baseOffset),
          ast: declaration
        })
        continue
      }
      if (declaration.type !== 'VariableDeclaration') continue
      for (const item of declaration.declarations ?? []) {
        const init = item.init
        if (
          item.id?.type !== 'Identifier' ||
          !init ||
          (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')
        ) {
          continue
        }
        const name = item.id.name
        const ordinal = names.get(name) ?? 0
        names.set(name, ordinal + 1)
        units.push({
          localId: `unit:${name}:${ordinal}`,
          kind: 'const-function',
          name,
          qualifiedPath: `${filePath}#${name}`,
          visibility: exported ? 'public' : 'private',
          signature: name,
          span: span(original, init.start, init.end, baseOffset),
          ast: init
        })
      }
    }
  }
  return units
}

/**
 * Формує import index і public import metadata лише за OXC ImportDeclaration.
 * @param {Record<string, unknown>} program OXC Program
 * @param {string} original повний file content
 * @param {number} baseOffset offset script у full content
 * @returns {{ imports: Array<Record<string, unknown>>, importedBindings: Map<string, string> }} imports + local binding → module specifier
 */
function collectImports(program, original, baseOffset) {
  const imports = []
  const importedBindings = new Map()
  for (const node of program.body ?? []) {
    if (node.type !== 'ImportDeclaration' || typeof node.source?.value !== 'string') continue
    const bindings = []
    for (const specifier of node.specifiers ?? []) {
      const localName = specifier.local?.name
      if (typeof localName !== 'string') continue
      const importedName = specifier.type === 'ImportSpecifier' ? (specifier.imported?.name ?? localName) : localName
      bindings.push({ localName, importedName })
      importedBindings.set(localName, node.source.value)
    }
    imports.push({ specifier: node.source.value, bindings, span: span(original, node.start, node.end, baseOffset) })
  }
  return { imports, importedBindings }
}

/**
 * Імʼя direct або member callee та його root identifier.
 * @param {Record<string, unknown>} node CallExpression
 * @returns {{ name: string | null, root: string | null }} call identity
 */
function callIdentity(node) {
  const callee = node.callee
  if (!callee || typeof callee !== 'object') return { name: null, root: null }
  if (callee.type === 'Identifier') return { name: callee.name, root: callee.name }
  if (callee.type !== 'MemberExpression' || callee.computed || callee.object?.type !== 'Identifier') {
    return { name: null, root: null }
  }
  const property = callee.property?.type === 'Identifier' ? callee.property.name : null
  return { name: property, root: callee.object.name }
}

/**
 * Будує evidence-backed invoke/integrate edges від кожного semantic unit.
 * @param {Array<Record<string, unknown>>} units semantic units
 * @param {Map<string, string>} importedBindings local import → module specifier
 * @param {string} filePath source path
 * @param {string} original full file content
 * @param {number} baseOffset script offset
 * @returns {Array<Record<string, unknown>>} deterministic edges
 */
function collectEdges(units, importedBindings, filePath, original, baseOffset) {
  const localUnits = new Map(units.map(unit => [unit.name, unit.localId]))
  const edges = []
  for (const unit of units) {
    walkAstWithAncestors(unit.ast, [], node => {
      if (node.type !== 'CallExpression') return
      const { root } = callIdentity(node)
      if (!root) return
      const evidence = [{ path: filePath, role: 'syntax', span: span(original, node.start, node.end, baseOffset) }]
      const target = localUnits.get(root)
      if (target && target !== unit.localId) {
        edges.push({ kind: 'invokes', fromLocalId: unit.localId, to: { localId: target }, evidence })
        return
      }
      const specifier = importedBindings.get(root)
      if (specifier) {
        edges.push({
          kind: 'integrates',
          fromLocalId: unit.localId,
          to: { unresolvedSpecifier: specifier, opaque: true },
          evidence
        })
      }
    })
  }
  return edges.toSorted((left, right) =>
    JSON.stringify([left.fromLocalId, left.kind, left.to, left.evidence[0].span]).localeCompare(
      JSON.stringify([right.fromLocalId, right.kind, right.to, right.evidence[0].span])
    )
  )
}

/**
 * Аналізує один script fragment через OXC та повертає повний normalized result.
 * @param {{ path: string, content: string, contentHash: string }} file source evidence
 * @param {string} original full file content для byte span-ів
 * @param {string} parserPath virtual path для OXC
 * @param {number} baseOffset script offset у full file content
 * @returns {Record<string, unknown> | null} fragment internals або null за parser failure
 */
function analyzeScript(file, original, parserPath, baseOffset) {
  const parsed = parseProgramAndCommentsOrNull(file.content, parserPath)
  if (!parsed?.program || !Array.isArray(parsed.program.body)) return null
  const unitsWithAst = collectUnits(parsed.program, file.path, original, baseOffset)
  const { imports, importedBindings } = collectImports(parsed.program, original, baseOffset)
  const edges = collectEdges(unitsWithAst, importedBindings, file.path, original, baseOffset)
  const units = unitsWithAst.map(({ ast: _ast, ...unit }) => unit)
  return {
    units,
    edges,
    imports,
    entryPoints: units
      .filter(unit => unit.visibility === 'public')
      .map(unit => ({ localId: unit.localId, reason: 'export' })),
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

/**
 * Перевіряє input adapter-а та гарантує, що він містить immutable source evidence.
 * @param {unknown} input сирий analyzeFile input
 * @returns {{ ok: true, file: { path: string, content: string, contentHash: string } } | { ok: false, result: ReturnType<typeof failure> }} input або failure
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
  if (EXTENSIONS.every(extension => !file.path.toLowerCase().endsWith(extension))) {
    return {
      ok: false,
      result: failure('unsupported-extension', file.path, `JS knowledge extractor не підтримує ${file.path}.`)
    }
  }
  return { ok: true, file }
}

/**
 * Аналізує один JS/TS/Vue source-file у deterministic normalized fragment.
 * @param {{ domain: object, file: { path: string, content: string, contentHash: string }, signal?: AbortSignal }} input source evidence
 * @returns {Record<string, unknown>} success fragment або blocking diagnostic
 */
export function analyzeFile(input) {
  const read = readFileInput(input)
  if (!read.ok) return read.result
  if (input.signal?.aborted) return failure('analysis-aborted', read.file.path, 'Аналіз source-файлу скасовано.')

  const isVue = read.file.path.toLowerCase().endsWith('.vue')
  if (!isVue) {
    const analyzed = analyzeScript(read.file, read.file.content, read.file.path, 0)
    if (!analyzed) return failure('parse-error', read.file.path, 'OXC не зміг повністю розпарсити source-файл.')
    return { ok: true, parser: PARSER, file: { ...read.file, language: languageFromPath(read.file.path) }, ...analyzed }
  }

  const sfc = vueScriptBlock(read.file.content, read.file.path)
  if (!sfc) {
    return failure(
      'vue-script-parse-error',
      read.file.path,
      'compiler-sfc не зміг розібрати Vue SFC або script-блок відсутній.'
    )
  }
  if (sfc.descriptor.template?.content?.trim()) {
    return failure(
      'vue-template-edges-unsupported',
      read.file.path,
      'Vue template містить поведінку, але template semantic edges ще не реалізовані; publication заблоковано.'
    )
  }
  const pseudoPath = read.file.path.slice(0, -'.vue'.length) + `.${sfc.block.lang === 'ts' ? 'ts' : 'js'}`
  const analyzed = analyzeScript(
    { ...read.file, content: sfc.block.content },
    read.file.content,
    pseudoPath,
    sfc.block.loc.start.offset
  )
  if (!analyzed) return failure('parse-error', read.file.path, 'OXC не зміг повністю розпарсити Vue script-блок.')
  return { ok: true, parser: PARSER, file: { ...read.file, language: 'vue' }, ...analyzed }
}

const jsKnowledgeExtractor = Object.freeze({
  id: 'knowledge-js',
  apiVersion: 1,
  extensions: EXTENSIONS,
  parser: PARSER,
  analyzeFile
})

/** Надає versioned `knowledge.extractor@1` provider для JS/TS/Vue. */
export default jsKnowledgeExtractor
