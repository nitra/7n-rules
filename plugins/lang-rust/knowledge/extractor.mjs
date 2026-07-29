/**
 * Будує fail-closed normalized fragments для Rust package-knowledge.
 *
 * Adapter використовує Tree-sitter WASM з офіційною Rust grammar. Старий
 * doc-files scanner навмисно не імпортується: regex/brace-пошук не є джерелом
 * production semantic graph. Будь-яка parser/runtime помилка повертає лише
 * blocking diagnostic, без partial fragment-а або whole-file fallback.
 */

import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'

import { Language, Parser } from 'web-tree-sitter'

const EXTENSIONS = Object.freeze(['.rs'])
const PARSER = Object.freeze({
  id: 'tree-sitter-rust-wasm',
  grammarVersion: 'tree-sitter-rust-0.24.0',
  runtimeVersion: 'web-tree-sitter-0.26.11'
})
const UNIT_TYPES = new Set([
  'function_item',
  'struct_item',
  'enum_item',
  'trait_item',
  'type_item',
  'const_item',
  'static_item',
  'mod_item'
])
const require = createRequire(import.meta.url)
const RUST_WASM_PATH = require.resolve('tree-sitter-rust/tree-sitter-rust.wasm')

/** @type {Promise<import('web-tree-sitter').Language> | null} */
let languagePromise = null

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
 * Ініціалізує shared WASM runtime і Rust grammar один раз на process.
 * @returns {Promise<import('web-tree-sitter').Language>} завантажена Rust grammar
 */
function loadRustLanguage() {
  languagePromise ??= initializeRustLanguage()
  return languagePromise
}

/**
 * Ініціалізує runtime перед завантаженням grammar-а; окрема async-функція
 * зберігає помилку init у cached Promise та не приховує її fallback-ом.
 * @returns {Promise<import('web-tree-sitter').Language>} завантажена Rust grammar
 */
async function initializeRustLanguage() {
  await Parser.init()
  return await Language.load(RUST_WASM_PATH)
}

/**
 * Перетворює Tree-sitter UTF-16 offset у UTF-8 byte offset оригінального файла.
 * @param {string} content повний content файла
 * @param {number} offset Tree-sitter UTF-16 offset
 * @returns {number} UTF-8 byte offset
 */
function byteOffset(content, offset) {
  return Buffer.byteLength(content.slice(0, offset), 'utf8')
}

/**
 * Створює half-open source span у UTF-8 bytes.
 * @param {string} content повний content файла
 * @param {import('web-tree-sitter').SyntaxNode} node AST node
 * @returns {{ startByte: number, endByte: number }} stable UTF-8 byte span
 */
function span(content, node) {
  return { startByte: byteOffset(content, node.startIndex), endByte: byteOffset(content, node.endIndex) }
}

/**
 * Повертає перший named child заданого типу.
 * @param {import('web-tree-sitter').SyntaxNode} node AST node
 * @param {string} type Tree-sitter node type
 * @returns {import('web-tree-sitter').SyntaxNode | null} знайдений child або null
 */
function childOfType(node, type) {
  return node.namedChildren.find(child => child.type === type) ?? null
}

/**
 * Повертає parser-derived назву declaration-а, або null для syntax variant-а,
 * який ще не має безпечної semantic mapping.
 * @param {import('web-tree-sitter').SyntaxNode} node item node
 * @returns {string | null} identifier
 */
function itemName(node) {
  const preferred =
    node.type === 'struct_item' || node.type === 'enum_item' || node.type === 'trait_item' || node.type === 'type_item'
      ? 'type_identifier'
      : 'identifier'
  return childOfType(node, preferred)?.text ?? childOfType(node, 'identifier')?.text ?? null
}

/**
 * Визначає Rust visibility тільки з AST modifier-а.
 * @param {import('web-tree-sitter').SyntaxNode} node item node
 * @param {'public'|'private'} [inherited] visibility enclosing declaration-а
 * @returns {'public'|'private'} normalized visibility
 */
function visibility(node, inherited = 'private') {
  return childOfType(node, 'visibility_modifier') ? 'public' : inherited
}

/**
 * Створює один semantic unit із parser-derived identity.
 * @param {{ node: import('web-tree-sitter').SyntaxNode, filePath: string, content: string, name: string, kind?: string, inheritedVisibility?: 'public'|'private', scope?: string | null, ordinals: Map<string, number> }} input unit source
 * @returns {Record<string, unknown>} normalized local unit
 */
function createUnit({
  node,
  filePath,
  content,
  name,
  kind = node.type,
  inheritedVisibility = 'private',
  scope = null,
  ordinals
}) {
  const scopedName = scope ? `${scope}::${name}` : name
  const ordinal = ordinals.get(scopedName) ?? 0
  ordinals.set(scopedName, ordinal + 1)
  return {
    localId: `unit:${scopedName}:${ordinal}`,
    kind,
    name,
    qualifiedPath: `${filePath}#${scopedName}`,
    visibility: visibility(node, inheritedVisibility),
    signature: scopedName,
    span: span(content, node),
    __node: node
  }
}

/**
 * Збирає top-level Rust units та methods, які належать impl/trait declaration-ам.
 * Інші вкладені parser nodes не інтерпретуються як самостійні units, щоб
 * local item не видавався за package-level declaration.
 * @param {import('web-tree-sitter').SyntaxNode} root Tree-sitter root
 * @param {string} filePath repo-relative path
 * @param {string} content source evidence
 * @returns {Array<Record<string, unknown>>} units у source order
 */
function collectUnits(root, filePath, content) {
  const ordinals = new Map()
  const units = []
  for (const node of root.namedChildren) {
    if (UNIT_TYPES.has(node.type)) {
      const name = itemName(node)
      if (name) units.push(createUnit({ node, filePath, content, name, ordinals }))
      if (node.type === 'trait_item')
        collectAssociatedUnits(node, name, visibility(node), filePath, content, ordinals, units)
      continue
    }
    if (node.type === 'impl_item') {
      const scope = childOfType(node, 'type_identifier')?.text ?? null
      if (scope) collectAssociatedUnits(node, scope, 'private', filePath, content, ordinals, units)
    }
  }
  return units
}

/**
 * Додає methods із impl/trait declaration list. Їхні spans і names походять
 * безпосередньо з AST; trait visibility успадковується від public trait.
 * @param {import('web-tree-sitter').SyntaxNode} container impl або trait node
 * @param {string | null} scope enclosing type/trait name
 * @param {'public'|'private'} inheritedVisibility enclosing visibility
 * @param {string} filePath repo-relative path
 * @param {string} content source evidence
 * @param {Map<string, number>} ordinals stable duplicate counters
 * @param {Array<Record<string, unknown>>} units target collection
 * @returns {void}
 */
function collectAssociatedUnits(container, scope, inheritedVisibility, filePath, content, ordinals, units) {
  if (!scope) return
  const list = childOfType(container, 'declaration_list')
  if (!list) return
  for (const node of list.namedChildren) {
    if (node.type !== 'function_item' && node.type !== 'function_signature') continue
    const name = itemName(node)
    if (!name) continue
    units.push(
      createUnit({
        node,
        filePath,
        content,
        name,
        kind: node.type === 'function_signature' ? 'trait-method' : 'method',
        inheritedVisibility,
        scope,
        ordinals
      })
    )
  }
}

/**
 * Повертає останній identifier у use path, який є local binding без alias-а.
 * @param {import('web-tree-sitter').SyntaxNode} node use path node
 * @returns {string | null} local binding
 */
function terminalIdentifier(node) {
  const identifiers = []
  visit(node, child => {
    if (child.type === 'identifier' || child.type === 'type_identifier') identifiers.push(child)
  })
  return identifiers.at(-1)?.text ?? null
}

/**
 * Рекурсивно обходить лише named Tree-sitter nodes у source order.
 * @param {import('web-tree-sitter').SyntaxNode} node start node
 * @param {(node: import('web-tree-sitter').SyntaxNode) => void} callback visitor
 * @returns {void}
 */
function visit(node, callback) {
  callback(node)
  for (const child of node.namedChildren) visit(child, callback)
}

/**
 * Додає import binding з already parser-derived source path.
 * @param {Array<{ localName: string, importedName: string }>} bindings target
 * @param {Map<string, string>} importedBindings local binding → opaque target
 * @param {string | null} localName local identifier
 * @param {string} importedName source-qualified identifier
 * @returns {void}
 */
function addBinding(bindings, importedBindings, localName, importedName) {
  if (!localName || importedBindings.has(localName)) return
  bindings.push({ localName, importedName })
  importedBindings.set(localName, importedName)
}

/**
 * Збирає один alias use clause з parser nodes.
 * @param {import('web-tree-sitter').SyntaxNode} target use_as_clause node
 * @param {Map<string, string>} importedBindings local binding → opaque target
 * @returns {Array<{ localName: string, importedName: string }>} bindings
 */
function collectAliasedBinding(target, importedBindings) {
  const bindings = []
  const source = target.namedChildren[0]
  const alias = target.namedChildren[1]
  if (source && alias) addBinding(bindings, importedBindings, alias.text, source.text)
  return bindings
}

/**
 * Збирає bindings із parser-derived `{ item, item as alias }` use list.
 * @param {import('web-tree-sitter').SyntaxNode} target scoped_use_list node
 * @param {Map<string, string>} importedBindings local binding → opaque target
 * @returns {Array<{ localName: string, importedName: string }>} bindings
 */
function collectScopedListBindings(target, importedBindings) {
  const bindings = []
  const prefix = target.namedChildren.find(child => child.type === 'scoped_identifier')
  const list = childOfType(target, 'use_list')
  if (!prefix || !list) return bindings
  for (const member of list.namedChildren) {
    if (member.type === 'use_as_clause') {
      const source = member.namedChildren[0]
      const alias = member.namedChildren[1]
      if (source && alias) addBinding(bindings, importedBindings, alias.text, `${prefix.text}::${source.text}`)
      continue
    }
    const localName = terminalIdentifier(member)
    if (localName) addBinding(bindings, importedBindings, localName, `${prefix.text}::${member.text}`)
  }
  return bindings
}

/**
 * Збирає local bindings для одного parser-derived use target.
 * @param {import('web-tree-sitter').SyntaxNode} target direct use child
 * @param {Map<string, string>} importedBindings local binding → opaque target
 * @returns {Array<{ localName: string, importedName: string }>} bindings
 */
function bindingsForUseTarget(target, importedBindings) {
  if (target.type === 'use_as_clause') return collectAliasedBinding(target, importedBindings)
  if (target.type === 'scoped_use_list') return collectScopedListBindings(target, importedBindings)
  const bindings = []
  const localName = terminalIdentifier(target)
  if (localName) addBinding(bindings, importedBindings, localName, target.text)
  return bindings
}

/**
 * Збирає imports і callable local bindings лише з Tree-sitter use nodes.
 * @param {import('web-tree-sitter').SyntaxNode} root Tree-sitter root
 * @param {string} content full source content
 * @returns {{ imports: Array<Record<string, unknown>>, importedBindings: Map<string, string> }} imports + binding index
 */
function collectImports(root, content) {
  const imports = []
  const importedBindings = new Map()
  for (const declaration of root.namedChildren) {
    if (declaration.type !== 'use_declaration') continue
    const target = declaration.namedChildren[0]
    if (!target) continue
    imports.push({
      specifier: target.text,
      bindings: bindingsForUseTarget(target, importedBindings),
      span: span(content, declaration)
    })
  }
  return { imports, importedBindings }
}

/**
 * Повертає local callable root і повне AST-derived callee path.
 * @param {import('web-tree-sitter').SyntaxNode} call call_expression node
 * @returns {{ root: string | null, path: string | null }} call identity
 */
function callIdentity(call) {
  const callee = call.childForFieldName('function')
  if (!callee) return { root: null, path: null }
  if (callee.type === 'identifier' || callee.type === 'type_identifier') return { root: callee.text, path: callee.text }
  if (callee.type === 'scoped_identifier') {
    let current = callee
    while (current.type === 'scoped_identifier') current = current.childForFieldName('path')
    return { root: current?.text ?? null, path: callee.text }
  }
  if (callee.type === 'field_expression') {
    const value = callee.childForFieldName('value')
    return { root: value?.text ?? null, path: callee.text }
  }
  return { root: null, path: null }
}

/**
 * Збирає invoke/integrate edges кожного unit-а, не вигадуючи resolution поза
 * поточним file: unresolved import завжди лишається opaque contract node.
 * @param {Array<Record<string, unknown>>} units normalized local units
 * @param {Map<string, string>} importedBindings local binding → opaque target
 * @param {string} filePath repo-relative path
 * @param {string} content full source content
 * @returns {Array<Record<string, unknown>>} deterministic semantic edges
 */
function collectEdges(units, importedBindings, filePath, content) {
  const localByPath = new Map(units.map(unit => [unit.signature, unit.localId]))
  const localByName = new Map()
  for (const unit of units) if (!localByName.has(unit.name)) localByName.set(unit.name, unit.localId)
  const edges = []
  for (const unit of units) {
    const unitNode = unit.__node
    visit(unitNode, node => {
      if (node.type !== 'call_expression') return
      const { root, path } = callIdentity(node)
      if (!root || !path) return
      const evidence = [{ path: filePath, role: 'syntax', span: span(content, node) }]
      const target = localByPath.get(path) ?? localByName.get(path)
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
 * Аналізує один Rust source-file через Tree-sitter WASM.
 * @param {{ domain: object, file: { path: string, content: string, contentHash: string }, signal?: AbortSignal }} input source evidence
 * @returns {Promise<Record<string, unknown>>} complete normalized fragment або blocking diagnostic
 */
export async function analyzeFile(input) {
  const file = input?.file
  if (
    !file ||
    typeof file.path !== 'string' ||
    typeof file.content !== 'string' ||
    typeof file.contentHash !== 'string'
  ) {
    return failure('invalid-file-input', null, 'file має містити path, content і contentHash.')
  }
  if (!file.path.toLowerCase().endsWith('.rs')) {
    return failure('unsupported-extension', file.path, `Rust knowledge extractor не підтримує ${file.path}.`)
  }
  if (input.signal?.aborted) return failure('analysis-aborted', file.path, 'Аналіз source-файлу скасовано.')

  let tree
  try {
    const language = await loadRustLanguage()
    if (input.signal?.aborted) return failure('analysis-aborted', file.path, 'Аналіз source-файлу скасовано.')
    const parser = new Parser()
    parser.setLanguage(language)
    tree = parser.parse(file.content)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return failure('parser-runtime-error', file.path, `Tree-sitter WASM не ініціалізував Rust parser: ${detail}`)
  }

  if (!tree?.rootNode || tree.rootNode.hasError) {
    return failure('parse-error', file.path, 'Tree-sitter Rust grammar не зміг повністю розпарсити source-файл.')
  }

  const unitsWithNodes = collectUnits(tree.rootNode, file.path, file.content)
  const { imports, importedBindings } = collectImports(tree.rootNode, file.content)
  const edges = collectEdges(unitsWithNodes, importedBindings, file.path, file.content)
  const units = unitsWithNodes.map(({ __node: _node, ...unit }) => unit)
  return {
    ok: true,
    parser: PARSER,
    file: { ...file, language: 'rust' },
    units,
    edges,
    imports,
    entryPoints: units
      .filter(unit => unit.visibility === 'public')
      .map(unit => ({ localId: unit.localId, reason: 'pub' })),
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

/** Обходить Tree-sitter node без text/brace fallback. */
function walkSyntax(node, visit) {
  visit(node)
  for (const child of node.namedChildren) walkSyntax(child, visit)
}

/** Чи AST subtree містить parser-derived identifier. */
function hasIdentifier(node, name) {
  let found = false
  walkSyntax(node, child => {
    if ((child.type === 'identifier' || child.type === 'type_identifier') && child.text === name) found = true
  })
  return found
}

/** Збирає active #[test] scenarios та assert!/assert_* macros через Rust grammar. */
export async function collectTestScenarios({ file }) {
  if (!file || typeof file.path !== 'string' || typeof file.content !== 'string' || !file.path.endsWith('.rs')) {
    return failure('invalid-file-input', file?.path ?? null, 'Rust test collector потребує .rs file.')
  }
  let tree
  try {
    const language = await loadRustLanguage()
    const parser = new Parser()
    parser.setLanguage(language)
    tree = parser.parse(file.content)
  } catch (error) {
    return failure('parser-runtime-error', file.path, `Tree-sitter Rust test parser не ініціалізувався: ${String(error)}`)
  }
  if (!tree?.rootNode || tree.rootNode.hasError) return failure('expected-test-parse-failed', file.path, 'Tree-sitter Rust не зміг розібрати test source.')
  const scenarios = []
  const children = tree.rootNode.namedChildren
  for (let index = 0; index < children.length; index++) {
    const node = children[index]
    if (node.type !== 'function_item') continue
    const attributes = []
    for (let cursor = index - 1; cursor >= 0 && children[cursor].type === 'attribute_item'; cursor--) attributes.push(children[cursor])
    if (!attributes.some(attribute => hasIdentifier(attribute, 'test')) || attributes.some(attribute => hasIdentifier(attribute, 'ignore'))) continue
    let asserted = false
    walkSyntax(node, child => {
      if (child.type === 'macro_invocation') {
        const macro = childOfType(child, 'identifier')?.text
        if (macro === 'assert' || macro === 'assert_eq' || macro === 'assert_ne') asserted = true
      }
    })
    const name = itemName(node)
    if (asserted && name) scenarios.push({ content: node.text, span: span(file.content, node), anchor: name })
  }
  return { ok: true, scenarios: scenarios.toSorted((left, right) => left.span.startByte - right.span.startByte) }
}

const rustKnowledgeExtractor = Object.freeze({
  id: 'knowledge-rust',
  apiVersion: 1,
  extensions: EXTENSIONS,
  parser: PARSER,
  analyzeFile,
  collectTestScenarios
})

/** Надає versioned `knowledge.extractor@1` provider для Rust. */
export default rustKnowledgeExtractor
