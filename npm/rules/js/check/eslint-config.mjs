/** @see ./docs/eslint-config.md */

/**
 * Детекція воркспейс-типів (node vs vue) і чистий планувальник scaffold/merge
 * для `eslint.config.js` consumer-репо. Використовується двома споживачами:
 *   - detector `main.mjs` (read-only): перевірка, що кожен vue-воркспейс
 *     присутній у `vue: [...]` аргументах getConfig — інакше .vue файли не
 *     парсяться eslint-ом;
 *   - T0 `fix-check.mjs`: детермінований scaffold відсутнього конфігу або
 *     хірургічний merge наявного (додати vue-воркспейси, прибрати їх із
 *     node-списку, доставити ignores) — БЕЗ повного перезапису файлу.
 *
 * Merge fail-safe: якщо структура конфігу не розпізнається regex-ами
 * (немає `getConfig({`), планувальник повертає null і файл не чіпається.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { globby } from 'globby'

/** Відсутній eslint.config.{js,mjs} — T0 скаффолдить із детектованих типів. */
export const ESLINT_CONFIG_MISSING = 'eslint-config-missing'
/** У ignores немає `**\/auto-imports.d.ts` — T0 дописує в наявний масив. */
export const ESLINT_CONFIG_IGNORES = 'eslint-config-ignores'
/** Vue-воркспейс відсутній у `vue: [...]` getConfig — .vue файли не парсяться. */
export const ESLINT_CONFIG_VUE_WORKSPACE = 'eslint-config-vue-workspace'

export const AUTO_IMPORTS_IGNORE = '**/auto-imports.d.ts'

const VUE_LIST_RE = /\bvue\s*:\s*\[([^\]]*)\]/u
const NODE_LIST_RE = /\bnode\s*:\s*\[([^\]]*)\]/u
const GET_CONFIG_OBJ_RE = /getConfig\(\s*\{/u
const IGNORES_OPEN_RE = /\bignores\s*:\s*\[/u
const STRING_ENTRY_RE = /'([^']*)'|"([^"]*)"/gu

/**
 * @param {string} p шлях воркспейсу з package.json або запис зі списку getConfig
 * @returns {string} канонічна форма без `./` на початку і `/` в кінці
 */
function normalizeWs(p) {
  let s = p.startsWith('./') ? p.slice(2) : p
  while (s.endsWith('/')) s = s.slice(0, -1)
  return s || '.'
}

/**
 * @param {string} abs абсолютний шлях до JSON-файлу
 * @returns {Promise<object|null>} розпарсений об'єкт або null (немає/битий)
 */
async function readJsonOrNull(abs) {
  try {
    return JSON.parse(await readFile(abs, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Розгортає записи `workspaces` root package.json у список наявних директорій
 * (glob-записи типу `packages/*` — через globby onlyDirectories).
 * @param {string} cwd корінь репозиторію
 * @param {unknown[]} patterns поле workspaces
 * @returns {Promise<string[]>} posix-relative директорії воркспейсів, що існують
 */
async function expandWorkspaces(cwd, patterns) {
  const dirs = []
  for (const p of patterns) {
    if (typeof p !== 'string' || p.length === 0) continue
    const norm = normalizeWs(p)
    if (norm.includes('*')) {
      dirs.push(...(await globby(norm, { cwd, onlyDirectories: true, gitignore: false })))
    } else if (existsSync(join(cwd, norm))) {
      dirs.push(norm)
    }
  }
  return [...new Set(dirs.map(d => normalizeWs(d)))]
}

/**
 * Чи є директорія Vue-кодом: `vue`/`nuxt` у deps її package.json (дешева
 * перевірка першою) або наявність бодай одного `.vue` файлу.
 * @param {string} cwd корінь репозиторію
 * @param {string} ws posix-relative директорія воркспейсу (або `.` для кореня)
 * @returns {Promise<boolean>} true — vue-воркспейс
 */
async function isVueWorkspace(cwd, ws) {
  const dir = ws === '.' ? cwd : join(cwd, ws)
  const pkg = await readJsonOrNull(join(dir, 'package.json'))
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  if ('vue' in deps || 'nuxt' in deps) return true
  const vueFiles = await globby('**/*.vue', {
    cwd: dir,
    gitignore: false,
    ignore: ['**/node_modules/**', '**/dist/**'],
    deep: 8
  })
  return vueFiles.length > 0
}

/**
 * Класифікує репозиторій за воркспейс-типами для аргументів getConfig.
 * Монорепо (workspaces у root package.json) — кожен воркспейс окремо;
 * без workspaces — сам корінь як `.`.
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<{ node: string[], vue: string[] }>} директорії за типами
 */
export async function detectWorkspaceTypes(cwd) {
  const pkg = await readJsonOrNull(join(cwd, 'package.json'))
  const wsField = Array.isArray(pkg?.workspaces) ? pkg.workspaces : []
  const dirs = await expandWorkspaces(cwd, wsField)

  if (dirs.length === 0) {
    const rootIsVue = await isVueWorkspace(cwd, '.')
    return rootIsVue ? { node: [], vue: ['.'] } : { node: ['.'], vue: [] }
  }

  /** @type {{ node: string[], vue: string[] }} */
  const types = { node: [], vue: [] }
  for (const ws of dirs) {
    if (await isVueWorkspace(cwd, ws)) {
      types.vue.push(ws)
    } else {
      types.node.push(ws)
    }
  }
  return types
}

/**
 * Записи string-літералів усередині вмісту списку (`vue: [...]`/`node: [...]`).
 * @param {string|undefined} inner текст між дужками списку
 * @returns {string[]} нормалізовані записи списку
 */
function listEntries(inner) {
  if (inner === undefined) return []
  return inner
    .matchAll(STRING_ENTRY_RE)
    .map(m => normalizeWs(m[1] ?? m[2]))
    .toArray()
}

/**
 * Vue-записи з тексту конфігу — для перевірки detector-ом.
 * @param {string} raw вміст eslint.config
 * @returns {string[]} нормалізовані записи `vue: [...]`
 */
export function parseVueList(raw) {
  return listEntries(raw.match(VUE_LIST_RE)?.[1])
}

/**
 * @param {string} ws запис для вставки у список
 * @returns {string} одинарно-квотований літерал
 */
function quote(ws) {
  return `'${ws}'`
}

/**
 * Повний шаблон eslint.config.js для scaffold (файл відсутній). Включає лише
 * непорожні типи; порядок ключів — node, vue (стиль власного конфігу репо).
 * @param {{ node: string[], vue: string[] }} types детектовані воркспейс-типи
 * @returns {string} вміст файлу
 */
export function renderEslintConfigScaffold(types) {
  const args = []
  if (types.node.length > 0) args.push(`    node: [${types.node.map(w => quote(w)).join(', ')}]`)
  if (types.vue.length > 0) args.push(`    vue: [${types.vue.map(w => quote(w)).join(', ')}]`)
  return [
    "import { getConfig } from '@nitra/eslint-config'",
    '',
    'export default [',
    '  {',
    `    ignores: ['${AUTO_IMPORTS_IGNORE}']`,
    '  },',
    '  ...getConfig({',
    args.join(',\n'),
    '  })',
    ']',
    ''
  ].join('\n')
}

/**
 * Хірургічний merge наявного конфігу під детектовані типи:
 *   1) відсутній `**\/auto-imports.d.ts` → вставка в перший `ignores: [`;
 *   2) vue-воркспейси поза `vue: [...]` → вставка у список (або нова властивість
 *      одразу після `getConfig({`);
 *   3) ті самі воркспейси у `node: [...]` → вилучення звідти.
 * Решта файлу (кастомні ignores, overrides, коментарі) — недоторкана.
 * @param {string} raw вміст eslint.config
 * @param {{ node: string[], vue: string[] }} types детектовані воркспейс-типи
 * @returns {string} новий вміст (=== raw, якщо merge неможливий/не потрібен)
 */
export function mergeEslintConfig(raw, types) {
  let out = raw

  if (!out.includes(AUTO_IMPORTS_IGNORE) && IGNORES_OPEN_RE.test(out)) {
    out = out.replace(IGNORES_OPEN_RE, m => `${m}'${AUTO_IMPORTS_IGNORE}', `)
  }

  const missingVue = types.vue.filter(ws => !parseVueList(out).includes(ws))
  if (missingVue.length > 0) {
    const inserted = missingVue.map(w => quote(w)).join(', ')
    const vueMatch = out.match(VUE_LIST_RE)
    if (vueMatch) {
      const rest = vueMatch[1].trim().length > 0 ? `, ${vueMatch[1]}` : vueMatch[1]
      out = out.replace(VUE_LIST_RE, () => `vue: [${inserted}${rest}]`)
    } else if (GET_CONFIG_OBJ_RE.test(out)) {
      out = out.replace(GET_CONFIG_OBJ_RE, m => `${m}\n    vue: [${inserted}],`)
    }
    // без getConfig({ — merge неможливий, лишаємо як є (fail-safe)
  }

  const nodeMatch = out.match(NODE_LIST_RE)
  if (nodeMatch) {
    const entries = listEntries(nodeMatch[1])
    const kept = entries.filter(e => !types.vue.includes(e))
    if (kept.length !== entries.length) {
      out = out.replace(NODE_LIST_RE, () => `node: [${kept.map(w => quote(w)).join(', ')}]`)
    }
  }

  return out
}

/**
 * План детермінованого фіксу eslint.config для T0: scaffold відсутнього файлу
 * або merge наявного. Ідемпотентний — повторний виклик на виправленому дереві
 * повертає null.
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<{ path: string, content: string, message: string }|null>} запис для виконання або null
 */
export async function planEslintConfigFix(cwd) {
  const types = await detectWorkspaceTypes(cwd)

  const existing = ['eslint.config.js', 'eslint.config.mjs'].find(f => existsSync(join(cwd, f)))
  if (!existing) {
    const summary = [
      types.node.length > 0 ? `node: [${types.node.join(', ')}]` : '',
      types.vue.length > 0 ? `vue: [${types.vue.join(', ')}]` : ''
    ]
      .filter(Boolean)
      .join(', ')
    return {
      path: join(cwd, 'eslint.config.js'),
      content: renderEslintConfigScaffold(types),
      message: `створено eslint.config.js (${summary})`
    }
  }

  const abs = join(cwd, existing)
  const raw = await readFile(abs, 'utf8')
  const merged = mergeEslintConfig(raw, types)
  if (merged === raw) return null
  return {
    path: abs,
    content: merged,
    message: `${existing}: merge під воркспейс-типи (vue: [${types.vue.join(', ')}])`
  }
}
