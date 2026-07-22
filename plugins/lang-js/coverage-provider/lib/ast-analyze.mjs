/**
 * Статичний аналіз JS/ESM-джерела через oxc (`./parse-ast.mjs` — ESTree-адаптер
 * замість колишнього `rollup/parseAst`).
 *
 * Витягує:
 *  - externalMocks — точні `vi.mock()`-рядки з shape, виведеним з використання імпортів
 *  - exportedNames — імена експортованих символів
 *  - internalNames — неекспортовані top-level declaration-и
 *  - hasSideEffects — top-level виклики (напр. `checkEnv([...])`)
 *  - envReads — читання `process.env` / `env.KEY` (для vi.stubEnv-підказок)
 *  - usesFetch — чи викликає джерело `fetch()`
 */
import { parseAst } from './parse-ast.mjs'

const FETCH_CALL_RE = /\bfetch\s*\(/

// ---------------------------------------------------------------------------
// AST walker
// ---------------------------------------------------------------------------

/**
 * Обходить AST та викликає callback для кожного вузла.
 * @param {unknown} node AST-вузол або значення вузла
 * @param {(node: Record<string, unknown>) => void} fn callback для кожного вузла
 * @returns {void}
 */
function walk(node, fn) {
  if (!node || typeof node !== 'object') return
  fn(/** @type {Record<string, unknown>} */ (node))
  for (const val of Object.values(node)) {
    if (Array.isArray(val)) {
      for (const child of val) walk(child, fn)
    } else if (val && typeof val === 'object' && val.type) {
      walk(val, fn)
    }
  }
}

// ---------------------------------------------------------------------------
// Mock shape derivation
// ---------------------------------------------------------------------------

/**
 * Збирає всі member-access ланцюжки для binding-імені.
 * `log.error(x)` → `['error']`; `log` (прямий виклик) → `[]`.
 * @param {unknown} ast розпарсений AST
 * @param {string} binding імʼя import-binding-а
 * @returns {string[][]} member-access ланцюжки для binding-а
 */
function collectUsagePaths(ast, binding) {
  const paths = []
  walk(ast, node => {
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === binding) {
      paths.push([])
      return
    }
    if (node.type === 'MemberExpression' && !node.computed) {
      const chain = []
      let cur = node
      while (cur?.type === 'MemberExpression' && !cur.computed) {
        chain.unshift(cur.property?.name ?? '')
        cur = cur.object
      }
      if (cur?.type === 'Identifier' && cur.name === binding) {
        paths.push(chain)
      }
    }
  })
  return paths
}

/**
 * Будує вкладений shape-обʼєкт з usage-ланцюжків.
 * `[['error'], ['warn']]` → `{ error: 'vi.fn()', warn: 'vi.fn()' }`; `[[]]` → `'vi.fn()'`.
 * @param {string[][]} paths usage-ланцюжки одного binding-а
 * @returns {string | Record<string, unknown>} mock shape
 */
function buildShape(paths) {
  if (!paths.length || paths.some(p => p.length === 0)) return 'vi.fn()'
  const shape = {}
  for (const path of paths) {
    let obj = shape
    for (let i = 0; i < path.length - 1; i++) {
      if (!obj[path[i]] || typeof obj[path[i]] === 'string') obj[path[i]] = {}
      obj = obj[path[i]]
    }
    const last = path.at(-1)
    if (!obj[last]) obj[last] = 'vi.fn()'
  }
  return shape
}

/**
 * Серіалізує mock shape назад у форматований JS-обʼєкт.
 * @param {string | Record<string, unknown>} shape дерево mock shape
 * @param {number} depth глибина відступу
 * @returns {string} форматований текст JS-обʼєкта
 */
function serializeShape(shape, depth = 0) {
  if (shape === 'vi.fn()') return 'vi.fn()'
  const pad = '  '.repeat(depth + 1)
  const close = '  '.repeat(depth)
  const entries = Object.entries(shape).map(([k, v]) => `${pad}${k}: ${serializeShape(v, depth + 1)}`)
  return `{
${entries.join(',\n')}
${close}}`
}

// ---------------------------------------------------------------------------
// Env reads
// ---------------------------------------------------------------------------

/**
 * Збирає env-ключі, що читаються як `env.KEY` або `process.env.KEY`.
 * @param {unknown} ast розпарсений AST
 * @returns {string[]} унікальні env-ключі
 */
function collectEnvReads(ast) {
  const keys = new Set()
  walk(ast, node => {
    // env.KEY or process.env.KEY
    if (
      node.type === 'MemberExpression' &&
      !node.computed &&
      node.object?.type === 'Identifier' &&
      (node.object.name === 'env' || node.object.name === 'process')
    ) {
      const prop = node.property?.name
      if (prop === 'env') return // process.env itself, not a key
      if (node.object.name === 'env' && prop) {
        keys.add(prop)
      }
    }
    if (
      node.type === 'MemberExpression' &&
      !node.computed &&
      node.object?.type === 'MemberExpression' &&
      node.object.object?.name === 'process' &&
      node.object.property?.name === 'env' &&
      node.property?.name
    ) {
      keys.add(node.property.name)
    }
  })
  return [...keys]
}

/**
 * Мапить import-binding-и на назви пакетів.
 * @param {unknown} ast розпарсений AST
 * @returns {Map<string, string>} мапа binding → package
 */
function collectBindingToPkg(ast) {
  const bindingToPkg = new Map()
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    const pkg = node.source.value
    if (pkg.startsWith('node:') || pkg.startsWith('.')) continue
    for (const spec of node.specifiers ?? []) {
      bindingToPkg.set(spec.local.name, pkg)
    }
  }
  return bindingToPkg
}

/**
 * Збирає mock shape для кожного пакета за використанням binding-ів.
 * @param {unknown} ast розпарсений AST
 * @param {Map<string, string>} bindingToPkg мапа binding → package
 * @returns {Map<string, Record<string, string | Record<string, unknown>>>} shape-и пакетів
 */
function collectPackageShapes(ast, bindingToPkg) {
  const pkgShapes = new Map()
  for (const [binding, pkg] of bindingToPkg) {
    const paths = collectUsagePaths(ast, binding)
    const shape = buildShape(paths)
    if (!pkgShapes.has(pkg)) pkgShapes.set(pkg, {})
    pkgShapes.get(pkg)[binding] = shape
  }
  return pkgShapes
}

/**
 * Перетворює shape-и пакетів на `vi.mock(...)`-рядки.
 * @param {Map<string, Record<string, string | Record<string, unknown>>>} pkgShapes shape-и пакетів
 * @returns {Array<{pkg: string, mockLine: string}>} визначення mock-рядків
 */
function collectExternalMocks(pkgShapes) {
  const externalMocks = []
  for (const [pkg, bindings] of pkgShapes) {
    const shape =
      Object.keys(bindings).length === 1 && Object.values(bindings)[0] === 'vi.fn()'
        ? `{ ${Object.keys(bindings)[0]}: vi.fn() }`
        : serializeShape(bindings)
    externalMocks.push({ pkg, mockLine: `vi.mock("${pkg}", () => (${shape}))` })
  }
  return externalMocks
}

/**
 * Збирає явно експортовані top-level імена.
 * @param {unknown} ast розпарсений AST
 * @returns {string[]} експортовані імена
 */
function collectExportedNames(ast) {
  const exportedNames = []
  for (const node of ast.body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue
    if (node.declaration.type === 'VariableDeclaration') {
      exportedNames.push(...node.declaration.declarations.map(d => d.id?.name).filter(Boolean))
    } else if (node.declaration.id?.name) {
      exportedNames.push(node.declaration.id.name)
    }
  }
  return exportedNames
}

/**
 * Збирає неекспортовані top-level declaration-и.
 * @param {unknown} ast розпарсений AST
 * @returns {string[]} внутрішні імена
 */
function collectInternalNames(ast) {
  const internalNames = []
  for (const node of ast.body) {
    if (node.type === 'VariableDeclaration') {
      internalNames.push(...node.declarations.map(d => d.id?.name).filter(Boolean))
    } else if (node.type === 'FunctionDeclaration' && node.id?.name) {
      internalNames.push(node.id.name)
    }
  }
  return internalNames
}

/**
 * Виявляє top-level виклики (side effects при завантаженні модуля).
 * @param {unknown} ast розпарсений AST
 * @returns {boolean} true коли модуль має top-level side effects
 */
function hasTopLevelSideEffects(ast) {
  return ast.body.some(n => n.type === 'ExpressionStatement' && n.expression?.type === 'CallExpression')
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Аналізує ESM-джерело та повертає структуровані дані для генерації тестів.
 * @param {string} source текст JS/ESM-джерела
 * @param {string} [filename] імʼя файлу для вибору діалекту парсера (.mjs/.ts)
 * @returns {{
 *   externalMocks: Array<{pkg: string, mockLine: string}>,
 *   exportedNames: string[],
 *   internalNames: string[],
 *   hasSideEffects: boolean,
 *   envReads: string[],
 *   usesFetch: boolean,
 * }} структуровані дані аналізу модуля
 */
export function analyzeModule(source, filename = 'module.mjs') {
  let ast
  try {
    ast = parseAst(source, filename)
  } catch {
    return {
      externalMocks: [],
      exportedNames: [],
      internalNames: [],
      hasSideEffects: false,
      envReads: [],
      usesFetch: false
    }
  }

  const bindingToPkg = collectBindingToPkg(ast)
  const pkgShapes = collectPackageShapes(ast, bindingToPkg)

  return {
    externalMocks: collectExternalMocks(pkgShapes),
    exportedNames: collectExportedNames(ast),
    internalNames: collectInternalNames(ast),
    hasSideEffects: hasTopLevelSideEffects(ast),
    envReads: collectEnvReads(ast),
    usesFetch: FETCH_CALL_RE.test(source)
  }
}
