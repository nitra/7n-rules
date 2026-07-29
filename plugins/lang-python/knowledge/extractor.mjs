/**
 * Будує fail-closed normalized fragments для Python package-knowledge.
 *
 * Adapter використовує повний Tree-sitter Python parser у WASM. Він не
 * застосовує regex або indent scanner для source-семантики: ERROR node,
 * невідомий import wildcard чи помилка ініціалізації блокують publication.
 */

import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'

import TreeSitter from '@vscode/tree-sitter-wasm'

const EXTENSIONS = Object.freeze(['.py'])
const PARSER = Object.freeze({
  id: 'tree-sitter-python-wasm',
  grammarVersion: 'tree-sitter-python-0.25.0',
  runtimeVersion: '@vscode/tree-sitter-wasm-0.3.1'
})
const PYTHON_WASM = fileURLToPath(import.meta.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm'))
const RUNTIME_WASM = fileURLToPath(import.meta.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm'))
const CONDITIONAL_SKIP_MARKER = ['skip', 'if'].join('')

let languagePromise

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
 * Перетворює Tree-sitter UTF-16 offset у UTF-8 byte offset оригінального файла.
 * @param {string} original повний content файла
 * @param {number} charOffset offset у code units оригінального файла
 * @returns {number} UTF-8 byte offset
 */
function byteOffset(original, charOffset) {
  return Buffer.byteLength(original.slice(0, charOffset), 'utf8')
}

/**
 * Створює source span у стабільних UTF-8 bytes.
 * @param {string} original повний content файла
 * @param {{ startIndex: number, endIndex: number }} node Tree-sitter node
 * @returns {{ startByte: number, endByte: number }} byte span
 */
function span(original, node) {
  return { startByte: byteOffset(original, node.startIndex), endByte: byteOffset(original, node.endIndex) }
}

/**
 * Ліниво ініціалізує shared WASM runtime та Python grammar один раз на process.
 * @returns {Promise<object>} завантажена Tree-sitter language
 */
async function loadPythonLanguage() {
  await TreeSitter.Parser.init({ locateFile: () => RUNTIME_WASM })
  return TreeSitter.Language.load(PYTHON_WASM)
}

/**
 * Повертає shared Promise Python grammar, не запускаючи runtime повторно.
 * @returns {Promise<object>} завантажена Tree-sitter language
 */
function pythonLanguage() {
  languagePromise ??= loadPythonLanguage()
  return languagePromise
}

/**
 * Обходить named Tree-sitter nodes у source order.
 * @param {object} node поточний Tree-sitter node
 * @param {object[]} ancestors ancestors від root до parent
 * @param {(node: object, ancestors: object[]) => void} visit callback для node
 */
function walkNamed(node, ancestors, visit) {
  visit(node, ancestors)
  for (const child of node.namedChildren) walkNamed(child, [...ancestors, node], visit)
}

/**
 * Повертає identifier, визначений field `name`, або null для malformed AST.
 * @param {object} node declaration node
 * @returns {string | null} ім'я declaration
 */
function declarationName(node) {
  const name = node.childForFieldName('name')
  return name?.type === 'identifier' ? name.text : null
}

/**
 * Формує qualified path з declaration ancestors, не прив'язуючи ID до абсолютного FS path.
 * @param {string} filePath repo-relative path source-файлу
 * @param {object[]} ancestors ancestors declaration node
 * @param {string} name local declaration name
 * @returns {string} stable language-qualified path
 */
function qualifiedPath(filePath, ancestors, name) {
  const parentNames = ancestors
    .filter(ancestor => ancestor.type === 'function_definition' || ancestor.type === 'class_definition')
    .map(ancestor => declarationName(ancestor))
    .filter(Boolean)
  return `${filePath}#${[...parentNames, name].join('.')}`
}

/**
 * Повертає всі Python declarations, включно з methods і nested helpers, у source order.
 * @param {object} root Tree-sitter module root
 * @param {string} filePath repo-relative source path
 * @param {string} content full source content
 * @returns {Array<Record<string, unknown>>} units з тимчасовим AST node
 */
function collectUnits(root, filePath, content) {
  const units = []
  const counts = new Map()
  walkNamed(root, [], (node, ancestors) => {
    if (node.type !== 'function_definition' && node.type !== 'class_definition') return
    const name = declarationName(node)
    if (!name) return
    const path = qualifiedPath(filePath, ancestors, name)
    const baseId = `${node.type === 'class_definition' ? 'class' : 'function'}:${path}`
    const ordinal = counts.get(baseId) ?? 0
    counts.set(baseId, ordinal + 1)
    units.push({
      localId: `unit:${baseId}:${ordinal}`,
      kind: node.type === 'class_definition' ? 'class' : 'function',
      name,
      qualifiedPath: path,
      visibility: name.startsWith('_') ? 'private' : 'public',
      signature: node.text.slice(0, node.text.indexOf(':') + 1).trim(),
      span: span(content, node),
      ast: node,
      isTopLevel: ancestors.length === 1 && ancestors[0].type === 'module'
    })
  })
  return units
}

/**
 * Повертає dotted target разом із local binding для import element.
 * @param {object} node import child (`dotted_name` або `aliased_import`)
 * @returns {{ specifier: string, localName: string } | null} normalized import binding
 */
function importBinding(node) {
  if (node.type === 'dotted_name') {
    const specifier = node.text
    return { specifier, localName: specifier.split('.', 1)[0] }
  }
  if (node.type !== 'aliased_import') return null
  const imported = node.childForFieldName('name')
  const alias = node.childForFieldName('alias')
  if (!imported || !alias) return null
  return { specifier: imported.text, localName: alias.text }
}

/**
 * Витягує import metadata та bindings з Tree-sitter import nodes.
 * @param {object} root Tree-sitter module root
 * @param {string} content full source content
 * @returns {{ ok: true, imports: Array<Record<string, unknown>>, importedBindings: Map<string, string> } | { ok: false, detail: string }} imports або unsupported form
 */
function collectImports(root, content) {
  const imports = []
  const importedBindings = new Map()
  for (const node of root.namedChildren) {
    if (node.type !== 'import_statement' && node.type !== 'import_from_statement') continue
    if (node.namedChildren.some(child => child.type === 'wildcard_import')) {
      return { ok: false, detail: '`from … import *` не має точних binding-ів для semantic edges.' }
    }
    if (node.type === 'import_statement') {
      const bindings = node.namedChildren.map(child => importBinding(child)).filter(Boolean)
      for (const binding of bindings) importedBindings.set(binding.localName, binding.specifier)
      imports.push({
        specifier: bindings.map(binding => binding.specifier).join(', '),
        bindings: bindings.map(binding => ({ localName: binding.localName, importedName: binding.specifier })),
        span: span(content, node)
      })
      continue
    }
    const moduleNode = node.childForFieldName('module_name') ?? node.childForFieldName('module')
    if (!moduleNode) return { ok: false, detail: 'Tree-sitter не надав module name для `from … import …`.' }
    const bindings = node.namedChildren
      .filter(
        child =>
          child.type !== 'relative_import' &&
          (child.startIndex !== moduleNode.startIndex || child.endIndex !== moduleNode.endIndex)
      )
      .map(child => importBinding(child))
      .filter(Boolean)
      .map(binding => ({ ...binding, specifier: `${moduleNode.text}.${binding.specifier}` }))
    if (bindings.length === 0) return { ok: false, detail: '`from … import …` не містить supported binding-ів.' }
    for (const binding of bindings) importedBindings.set(binding.localName, binding.specifier)
    imports.push({
      specifier: moduleNode.text,
      bindings: bindings.map(binding => ({ localName: binding.localName, importedName: binding.specifier })),
      span: span(content, node)
    })
  }
  return { ok: true, imports, importedBindings }
}

/**
 * Повертає root identifier direct або attribute Python call.
 * @param {object} node Tree-sitter `call` node
 * @returns {string | null} local/import root identifier
 */
function callRoot(node) {
  const callee = node.childForFieldName('function')
  if (!callee) return null
  if (callee.type === 'identifier') return callee.text
  if (callee.type !== 'attribute') return null
  const object = callee.childForFieldName('object')
  return object?.type === 'identifier' ? object.text : null
}

/**
 * Створює unique direct-name index; ambiguous names не отримують хибного local edge.
 * @param {Array<Record<string, unknown>>} units semantic units
 * @returns {Map<string, string>} name → localId only when unique
 */
function uniqueLocalUnits(units) {
  const matched = new Map()
  const ambiguous = new Set()
  for (const unit of units) {
    if (matched.has(unit.name)) ambiguous.add(unit.name)
    else matched.set(unit.name, unit.localId)
  }
  for (const name of ambiguous) matched.delete(name)
  return matched
}

/**
 * Обходить unit body, не повторюючи calls nested semantic units у parent coverage.
 * @param {object} node поточний Tree-sitter node
 * @param {object} unitRoot AST node semantic unit
 * @param {(node: object) => void} visit callback
 */
function walkUnitBody(node, unitRoot, visit) {
  if (node !== unitRoot && (node.type === 'function_definition' || node.type === 'class_definition')) return
  visit(node)
  for (const child of node.namedChildren) walkUnitBody(child, unitRoot, visit)
}

/**
 * Будує evidence-backed invokes/integrates edges для всіх parsed Python units.
 * @param {Array<Record<string, unknown>>} units semantic units
 * @param {Map<string, string>} importedBindings local binding → module specifier
 * @param {string} filePath source path
 * @param {string} content full source content
 * @returns {Array<Record<string, unknown>>} deterministic edges
 */
function collectEdges(units, importedBindings, filePath, content) {
  const localUnits = uniqueLocalUnits(units)
  const edges = []
  for (const unit of units) {
    walkUnitBody(unit.ast, unit.ast, node => {
      if (node.type !== 'call') return
      const root = callRoot(node)
      if (!root) return
      const evidence = [{ path: filePath, role: 'syntax', span: span(content, node) }]
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
 * Перевіряє input adapter-а та гарантує immutable source evidence.
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
  if (!file.path.toLowerCase().endsWith('.py')) {
    return {
      ok: false,
      result: failure('unsupported-extension', file.path, `Python knowledge extractor не підтримує ${file.path}.`)
    }
  }
  return { ok: true, file }
}

/**
 * Аналізує один Python source-file у deterministic normalized fragment.
 * @param {{ domain: object, file: { path: string, content: string, contentHash: string }, signal?: AbortSignal }} input source evidence
 * @returns {Promise<Record<string, unknown>>} success fragment або blocking diagnostic
 */
export async function analyzeFile(input) {
  const read = readFileInput(input)
  if (!read.ok) return read.result
  if (input.signal?.aborted) return failure('analysis-aborted', read.file.path, 'Аналіз source-файлу скасовано.')

  let language
  try {
    language = await pythonLanguage()
  } catch (error) {
    return failure(
      'parser-initialization-error',
      read.file.path,
      `Tree-sitter Python WASM не ініціалізувався: ${error.message}`
    )
  }
  if (input.signal?.aborted) return failure('analysis-aborted', read.file.path, 'Аналіз source-файлу скасовано.')

  const parser = new TreeSitter.Parser()
  parser.setLanguage(language)
  const tree = parser.parse(read.file.content)
  if (!tree?.rootNode || tree.rootNode.hasError) {
    return failure('parse-error', read.file.path, 'Tree-sitter Python не зміг повністю розпарсити source-файл.')
  }
  const unitsWithAst = collectUnits(tree.rootNode, read.file.path, read.file.content)
  const collectedImports = collectImports(tree.rootNode, read.file.content)
  if (!collectedImports.ok) return failure('unsupported-import-syntax', read.file.path, collectedImports.detail)
  const edges = collectEdges(unitsWithAst, collectedImports.importedBindings, read.file.path, read.file.content)
  const units = unitsWithAst.map(({ ast: _ast, isTopLevel: _isTopLevel, ...unit }) => unit)
  return {
    ok: true,
    parser: PARSER,
    file: { ...read.file, language: 'python' },
    units,
    edges,
    imports: collectedImports.imports,
    entryPoints: unitsWithAst
      .filter(unit => unit.isTopLevel && unit.visibility === 'public')
      .map(unit => ({ localId: unit.localId, reason: 'public-module-symbol' })),
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
 * Чи parser-derived subtree має identifier/attribute name.
 * @param {object} node Tree-sitter node
 * @param {string} expected expected identifier or attribute name
 * @returns {boolean} whether the subtree contains the name
 */
function testNameInTree(node, expected) {
  let found = false
  walkNamed(node, [], child => {
    if ((child.type === 'identifier' || child.type === 'attribute') && child.text.split('.').at(-1) === expected)
      found = true
  })
  return found
}

/**
 * Збирає active pytest/unittest test_* functions з assert_statement через Tree-sitter.
 * @param {{file: {path: string, content: string}}} input test source
 * @returns {Promise<{ok: true, scenarios: object[]} | {ok: false, diagnostics: object[]}>} scenarios or blocking diagnostic
 */
export async function collectTestScenarios({ file }) {
  if (!file || typeof file.path !== 'string' || typeof file.content !== 'string' || !file.path.endsWith('.py')) {
    return failure('invalid-file-input', file?.path ?? null, 'Python test collector потребує .py file.')
  }
  let language
  try {
    language = await pythonLanguage()
  } catch (error) {
    return failure(
      'parser-initialization-error',
      file.path,
      `Tree-sitter Python test parser не ініціалізувався: ${error.message}`
    )
  }
  const parser = new TreeSitter.Parser()
  parser.setLanguage(language)
  const tree = parser.parse(file.content)
  if (!tree?.rootNode || tree.rootNode.hasError)
    return failure('expected-test-parse-failed', file.path, 'Tree-sitter Python не зміг розібрати test source.')
  const scenarios = []
  walkNamed(tree.rootNode, [], (node, ancestors) => {
    if (node.type !== 'function_definition') return
    const name = declarationName(node)
    if (!name?.startsWith('test_')) return
    const decorated = ancestors.find(parent => parent.type === 'decorated_definition')
    if (
      decorated &&
      ['skip', CONDITIONAL_SKIP_MARKER, 'expectedFailure'].some(marker => testNameInTree(decorated, marker))
    )
      return
    let asserted = false
    walkNamed(node, [], child => {
      if (child.type === 'assert_statement') asserted = true
    })
    if (asserted) scenarios.push({ content: node.text, span: span(file.content, node), anchor: name })
  })
  return { ok: true, scenarios: scenarios.toSorted((left, right) => left.span.startByte - right.span.startByte) }
}

const pythonKnowledgeExtractor = Object.freeze({
  id: 'knowledge-python',
  apiVersion: 1,
  extensions: EXTENSIONS,
  parser: PARSER,
  analyzeFile,
  collectTestScenarios
})

/* Надає versioned `knowledge.extractor@1` provider для Python. */
export default pythonKnowledgeExtractor
