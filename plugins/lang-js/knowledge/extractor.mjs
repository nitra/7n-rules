/**
 * Будує fail-closed normalized fragments для JS/TS/Vue package-knowledge.
 *
 * Adapter використовує OXC для всіх script-файлів, а `@vue/compiler-sfc` і
 * `@vue/compiler-dom` — для SFC/template AST. Він не має whole-file fallback:
 * parser або непокритий template expression повертає blocking diagnostic.
 */

import { Buffer } from 'node:buffer'

import { parseProgramAndCommentsOrNull, walkAstWithAncestors } from '@7n/rules/scripts/utils/ast-scan-utils.mjs'

let vueCompilers = null
try {
  const [compilerSfc, compilerDom] = await Promise.all([import('@vue/compiler-sfc'), import('@vue/compiler-dom')])
  vueCompilers = { compilerSfc, compilerDom }
} catch {
  /* compiler dependencies are unavailable: .vue analysis must fail closed */
}

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
 * Повертає root identifier expression-а, не вгадуючи його з тексту.
 * @param {Record<string, unknown>} node OXC expression node
 * @returns {string | null} локальний або import binding root
 */
function expressionRoot(node) {
  if (node.type === 'ParenthesizedExpression') return node.expression ? expressionRoot(node.expression) : null
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression' && !node.computed && node.object?.type === 'Identifier') return node.object.name
  return node.type === 'CallExpression' ? callIdentity(node).root : null
}

/**
 * Повертає єдиний expression з OXC Program, створеного для template expression.
 * @param {Record<string, unknown>} program OXC Program
 * @returns {Record<string, unknown> | null} expression або null
 */
function singleProgramExpression(program) {
  const statement = program.body?.[0]
  if (program.body?.length !== 1 || statement?.type !== 'ExpressionStatement' || !statement.expression) return null
  return /** @type {Record<string, unknown>} */ (statement.expression)
}

/**
 * Перетворює parser-relative template expression span у span повного Vue SFC.
 * @param {string} original повний SFC source
 * @param {number} templateOffset UTF-16 offset початку template content
 * @param {number} expressionOffset UTF-16 offset expression у template content
 * @param {number} start OXC offset у expression parser input
 * @param {number} end OXC offset у expression parser input
 * @param {number} [wrapperOffset] службовий prefix навколо expression
 * @returns {{ startByte: number, endByte: number }} UTF-8 byte span
 */
function templateExpressionSpan(original, templateOffset, expressionOffset, start, end, wrapperOffset = 0) {
  return span(original, expressionOffset + start - wrapperOffset, expressionOffset + end - wrapperOffset, templateOffset)
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
 * Створює syntax evidence для template AST location у повному SFC.
 * @param {string} filePath source path
 * @param {string} original повний SFC source
 * @param {number} templateOffset UTF-16 offset template content
 * @param {{ start: { offset: number }, end: { offset: number } }} location Vue AST location
 * @returns {Array<{ path: string, role: string, span: { startByte: number, endByte: number } }>} provenance
 */
function templateEvidence(filePath, original, templateOffset, location) {
  return [{ path: filePath, role: 'syntax', span: span(original, location.start.offset, location.end.offset, templateOffset) }]
}

/**
 * Додає один deterministic template code-unit.
 * @param {{ units: Array<Record<string, unknown>>, ordinals: Map<string, number>, filePath: string, kind: string, name: string, location: object, original: string, templateOffset: number, attributes?: Record<string, unknown> }} input unit source
 * @returns {Record<string, unknown>} normalized unit
 */
function addTemplateUnit({ units, ordinals, filePath, kind, name, location, original, templateOffset, attributes = {} }) {
  const ordinal = ordinals.get(kind) ?? 0
  ordinals.set(kind, ordinal + 1)
  const localId = `template:${kind}:${ordinal}`
  const unit = {
    localId,
    kind: `template-${kind}`,
    name,
    qualifiedPath: `${filePath}#${localId}`,
    visibility: 'internal',
    signature: name,
    span: span(original, location.start.offset, location.end.offset, templateOffset),
    attributes: { template: true, ...attributes }
  }
  units.push(unit)
  return unit
}

/**
 * Створює edge до local script unit або opaque imported integration.
 * @param {{ edges: Array<Record<string, unknown>>, fromLocalId: string, kind: string, root: string | null, localUnits: Map<string, string>, importedBindings: Map<string, string>, evidence: Array<Record<string, unknown>> }} input edge facts
 * @returns {void}
 */
function addTemplateTargetEdge({ edges, fromLocalId, kind, root, localUnits, importedBindings, evidence }) {
  if (!root) return
  const localId = localUnits.get(root)
  if (localId) {
    edges.push({ kind, fromLocalId, to: { localId }, evidence })
    return
  }
  const specifier = importedBindings.get(root)
  if (specifier) edges.push({ kind: 'integrates', fromLocalId, to: { unresolvedSpecifier: specifier, opaque: true }, evidence })
}

/**
 * Розбирає template JS expression OXC-ом, не змішуючи її з HTML-парсером.
 * `v-on` може містити statement-list, інші directive/interpolation expression
 * мусять бути рівно одним JS expression; незрозумілий синтаксис блокує fragment.
 * @param {string} content compiler-dom SimpleExpression content
 * @param {boolean} eventHandler чи дозволений handler statement-list
 * @returns {{ program: Record<string, unknown>, wrapperOffset: number, root: string | null } | null} OXC result
 */
function parseTemplateExpression(content, eventHandler) {
  const wrapperOffset = eventHandler ? 0 : 1
  const parsed = parseProgramAndCommentsOrNull(eventHandler ? content : `(${content})`, 'template-expression.ts')
  if (!parsed?.program) return null
  const expression = singleProgramExpression(parsed.program)
  if (!eventHandler && !expression) return null
  return { program: parsed.program, wrapperOffset, root: expression ? expressionRoot(expression) : null }
}

/**
 * Додає effect edges усіх викликів template expression-а та handler root link.
 * @param {{ parsed: { program: Record<string, unknown>, wrapperOffset: number, root: string | null }, eventHandler: boolean, expressionOffset: number, expressionLocation: object, unit: Record<string, unknown>, filePath: string, original: string, templateOffset: number, localUnits: Map<string, string>, importedBindings: Map<string, string>, edges: Array<Record<string, unknown>> }} input expression facts
 * @returns {void}
 */
function addTemplateExpressionEdges({
  parsed,
  eventHandler,
  expressionOffset,
  expressionLocation,
  unit,
  filePath,
  original,
  templateOffset,
  localUnits,
  importedBindings,
  edges
}) {
  const fullEvidence = templateEvidence(filePath, original, templateOffset, expressionLocation)
  if (eventHandler) {
    addTemplateTargetEdge({
      edges,
      fromLocalId: unit.localId,
      kind: 'triggers',
      root: parsed.root,
      localUnits,
      importedBindings,
      evidence: fullEvidence
    })
  }
  walkAstWithAncestors(parsed.program, [], node => {
    if (node.type !== 'CallExpression') return
    const { root } = callIdentity(node)
    const evidence = [
      {
        path: filePath,
        role: 'syntax',
        span: templateExpressionSpan(
          original,
          templateOffset,
          expressionOffset,
          node.start,
          node.end,
          parsed.wrapperOffset
        )
      }
    ]
    addTemplateTargetEdge({
      edges,
      fromLocalId: unit.localId,
      kind: eventHandler ? 'triggers' : 'invokes',
      root,
      localUnits,
      importedBindings,
      evidence
    })
  })
}

/**
 * Визначає, чи AST element є integration boundary компонента, а не native HTML.
 * compiler-dom позначає PascalCase та dynamic `<component>` як COMPONENT; custom
 * elements у kebab-case додатково зберігаються як boundary без текстових евристик.
 * @param {Record<string, unknown>} node Vue ELEMENT node
 * @returns {boolean} чи потрібен opaque component contract
 */
function isComponentBoundary(node) {
  return node.tagType === 1 || (node.tagType === 0 && node.tag.includes('-'))
}

/**
 * Аналізує одне directive expression або dynamic argument; за неможливості
 * повного OXC coverage повертає blocking detail, а не пропускає поведінку.
 * @param {{ expression: Record<string, unknown>, eventHandler: boolean, unit: Record<string, unknown>, filePath: string, original: string, templateOffset: number, localUnits: Map<string, string>, importedBindings: Map<string, string>, edges: Array<Record<string, unknown>> }} input template expression context
 * @returns {string | null} blocking detail або null
 */
function analyzeTemplateExpression({
  expression,
  eventHandler,
  unit,
  filePath,
  original,
  templateOffset,
  localUnits,
  importedBindings,
  edges
}) {
  if (expression.isStatic || !expression.content.trim()) return null
  const parsed = parseTemplateExpression(expression.content, eventHandler)
  if (!parsed) return `OXC не зміг повністю розібрати ${eventHandler ? 'event handler' : 'template expression'} "${expression.content}".`
  addTemplateExpressionEdges({
    parsed,
    eventHandler,
    expressionOffset: expression.loc.start.offset,
    expressionLocation: expression.loc,
    unit,
    filePath,
    original,
    templateOffset,
    localUnits,
    importedBindings,
    edges
  })
  return null
}

/**
 * Додає semantic unit для directive й аналізує його expression/динамічний arg.
 * @param {{ prop: Record<string, unknown>, units: Array<Record<string, unknown>>, ordinals: Map<string, number>, filePath: string, original: string, templateOffset: number, localUnits: Map<string, string>, importedBindings: Map<string, string>, edges: Array<Record<string, unknown>>, entryPoints: Array<Record<string, unknown>> }} input directive context
 * @returns {string | null} blocking detail або null
 */
function analyzeTemplateDirective({
  prop,
  units,
  ordinals,
  filePath,
  original,
  templateOffset,
  localUnits,
  importedBindings,
  edges,
  entryPoints
}) {
  const eventHandler = prop.name === 'on'
  const unit = addTemplateUnit({
    units,
    ordinals,
    filePath,
    kind: 'directive',
    name: prop.rawName ?? `v-${prop.name}`,
    location: prop.loc,
    original,
    templateOffset,
    attributes: {
      directive: prop.name,
      argument: prop.arg?.content ?? null,
      modifiers: prop.modifiers ?? []
    }
  })
  if (eventHandler) entryPoints.push({ localId: unit.localId, reason: `template-event:${prop.arg?.content ?? 'dynamic'}` })
  const expressionDetail = prop.exp
    ? analyzeTemplateExpression({
        expression: prop.exp,
        eventHandler,
        unit,
        filePath,
        original,
        templateOffset,
        localUnits,
        importedBindings,
        edges
      })
    : null
  if (expressionDetail) return expressionDetail
  if (!prop.arg || prop.arg.isStatic) return null
  return analyzeTemplateExpression({
    expression: prop.arg,
    eventHandler: false,
    unit,
    filePath,
    original,
    templateOffset,
    localUnits,
    importedBindings,
    edges
  })
}

/**
 * Аналізує component boundary і всі directive props одного template element.
 * @param {{ node: Record<string, unknown>, units: Array<Record<string, unknown>>, ordinals: Map<string, number>, filePath: string, original: string, templateOffset: number, localUnits: Map<string, string>, importedBindings: Map<string, string>, edges: Array<Record<string, unknown>>, entryPoints: Array<Record<string, unknown>> }} input element context
 * @returns {string | null} blocking detail або null
 */
function analyzeTemplateElement({
  node,
  units,
  ordinals,
  filePath,
  original,
  templateOffset,
  localUnits,
  importedBindings,
  edges,
  entryPoints
}) {
  if (isComponentBoundary(node)) {
    const unit = addTemplateUnit({
      units,
      ordinals,
      filePath,
      kind: 'component',
      name: node.tag,
      location: node.loc,
      original,
      templateOffset,
      attributes: { tag: node.tag }
    })
    edges.push({
      kind: 'integrates',
      fromLocalId: unit.localId,
      to: { unresolvedSpecifier: `vue-component:${node.tag}`, opaque: true },
      evidence: templateEvidence(filePath, original, templateOffset, node.loc)
    })
  }
  for (const prop of node.props ?? []) {
    if (prop.type === 6) continue
    if (prop.type !== 7) return `compiler-dom повернув непідтримуваний template prop node type ${String(prop.type)}.`
    const detail = analyzeTemplateDirective({
      prop,
      units,
      ordinals,
      filePath,
      original,
      templateOffset,
      localUnits,
      importedBindings,
      edges,
      entryPoints
    })
    if (detail) return detail
  }
  return null
}

/**
 * Обходить compiler-dom template AST і повертає всі template units/edges або
 * один blocking diagnostic detail. Кожен directive/interpolation/component
 * отримує coverage unit; parser не має silent skip branches.
 * @param {{ ast: Record<string, unknown>, units: Array<Record<string, unknown>>, filePath: string, original: string, templateOffset: number, scriptUnits: Array<Record<string, unknown>>, imports: Array<Record<string, unknown>> }} input template source
 * @returns {{ edges: Array<Record<string, unknown>>, entryPoints: Array<Record<string, unknown>> } | { detail: string }} complete template behavior або failure
 */
function analyzeTemplate({ ast, units, filePath, original, templateOffset, scriptUnits, imports }) {
  const edges = []
  const entryPoints = []
  const ordinals = new Map()
  const localUnits = new Map(scriptUnits.map(unit => [unit.name, unit.localId]))
  const importedBindings = new Map(imports.flatMap(item => item.bindings.map(binding => [binding.localName, item.specifier])))
  let detail = null
  const visit = node => {
    if (detail || !node || typeof node !== 'object') return
    if (node.type === 0) {
      for (const child of node.children ?? []) visit(child)
      return
    }
    if (node.type === 1) {
      detail = analyzeTemplateElement({
        node,
        units,
        ordinals,
        filePath,
        original,
        templateOffset,
        localUnits,
        importedBindings,
        edges,
        entryPoints
      })
      if (detail) return
      for (const child of node.children ?? []) visit(child)
      return
    }
    if (node.type === 5) {
      const unit = addTemplateUnit({
        units,
        ordinals,
        filePath,
        kind: 'interpolation',
        name: 'interpolation',
        location: node.loc,
        original,
        templateOffset,
        attributes: { expression: node.content?.content ?? '' }
      })
      detail = analyzeTemplateExpression({
        expression: node.content,
        eventHandler: false,
        unit,
        filePath,
        original,
        templateOffset,
        localUnits,
        importedBindings,
        edges
      })
      return
    }
    if (node.type !== 2 && node.type !== 3) detail = `compiler-dom повернув непідтримуваний template AST node type ${String(node.type)}.`
  }
  visit(ast)
  return detail ? { detail } : { edges, entryPoints }
}

/**
 * Дедуплікує edges, залишаючи відмінні evidence spans як окремі факти.
 * @param {Array<Record<string, unknown>>} edges normalized edges
 * @returns {Array<Record<string, unknown>>} stable unique edges
 */
function sortEdges(edges) {
  const unique = new Map()
  for (const edge of edges) unique.set(JSON.stringify([edge.fromLocalId, edge.kind, edge.to, edge.evidence]), edge)
  return unique.values().toArray().toSorted((left, right) =>
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

  if (!vueCompilers) {
    return failure(
      'vue-template-parser-unavailable',
      read.file.path,
      'Для Vue template аналізу потрібні @vue/compiler-sfc та @vue/compiler-dom.'
    )
  }
  let sfc
  try {
    sfc = vueCompilers.compilerSfc.parse(read.file.content, { filename: read.file.path })
  } catch {
    return failure('vue-sfc-parse-error', read.file.path, 'compiler-sfc не зміг розібрати Vue SFC.')
  }
  if (sfc.errors.length > 0) {
    return failure('vue-sfc-parse-error', read.file.path, `compiler-sfc: ${String(sfc.errors[0])}`)
  }
  const block = sfc.descriptor.scriptSetup ?? sfc.descriptor.script
  if (!block?.content?.trim()) {
    return failure('vue-script-parse-error', read.file.path, 'Vue SFC не містить непорожнього script-блоку.')
  }
  const pseudoPath = read.file.path.slice(0, -'.vue'.length) + `.${block.lang === 'ts' ? 'ts' : 'js'}`
  const analyzed = analyzeScript(
    { ...read.file, content: block.content },
    read.file.content,
    pseudoPath,
    block.loc.start.offset
  )
  if (!analyzed) return failure('parse-error', read.file.path, 'OXC не зміг повністю розпарсити Vue script-блок.')
  const template = sfc.descriptor.template
  if (!template?.content.trim()) return { ok: true, parser: PARSER, file: { ...read.file, language: 'vue' }, ...analyzed }
  const templateErrors = []
  let ast
  try {
    ast = vueCompilers.compilerDom.baseParse(template.content, {
      onError: error => {
        templateErrors.push(error)
      }
    })
  } catch {
    return failure('vue-template-parse-error', read.file.path, 'compiler-dom не зміг розібрати Vue template.')
  }
  if (templateErrors.length > 0) {
    return failure('vue-template-parse-error', read.file.path, `compiler-dom: ${templateErrors[0].message}`)
  }
  const templateResult = analyzeTemplate({
    ast,
    units: analyzed.units,
    filePath: read.file.path,
    original: read.file.content,
    templateOffset: template.loc.start.offset,
    scriptUnits: analyzed.units,
    imports: analyzed.imports
  })
  if ('detail' in templateResult) return failure('vue-template-expression-unsupported', read.file.path, templateResult.detail)
  const units = analyzed.units
  const edges = sortEdges([...analyzed.edges, ...templateResult.edges])
  return {
    ok: true,
    parser: PARSER,
    file: { ...read.file, language: 'vue' },
    units,
    edges,
    imports: analyzed.imports,
    entryPoints: [...analyzed.entryPoints, ...templateResult.entryPoints],
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

const jsKnowledgeExtractor = Object.freeze({
  id: 'knowledge-js',
  apiVersion: 1,
  extensions: EXTENSIONS,
  parser: PARSER,
  analyzeFile
})

/** Надає versioned `knowledge.extractor@1` provider для JS/TS/Vue. */
export default jsKnowledgeExtractor
