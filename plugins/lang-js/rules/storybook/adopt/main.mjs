/**
 * Adopt-режим канону Storybook (ADR канон-storybook-для-vue-компонентних-бібліотек,
 * Кластер 8 + розширення 2026-07-20 хвиля 2a; main.mdc). Для пакетів, де ВЖЕ є ручний
 * `.storybook/`, що не збігається з каноном, — діагностика diff по секціях проти
 * канонічних `template/` (main.js, preview.js, empty-vite.config.js — лише бібліотеки,
 * mocks/gql-sse.js, package.json#scripts.storybook, vitest test.projects,
 * vitest.stryker.config, `.storybook/fixtures/` — лише app-пакети), БЕЗ сліпого
 * перезапису розбіжних файлів. Автофікс (`--fix-missing`) — лише для секцій, яких
 * немає ВЗАГАЛІ (той самий рендер, що й T0-фікс concern-ів `scaffold`/`vitest-config` —
 * переюз, не дублювання шаблонування); `.storybook/fixtures/` — виняток, вміст
 * app-специфічний і не має канонічного рендера, тож `--fix-missing` його не генерує.
 *
 * Circuit breaker (ADR): збій діагностики чи фіксу одного пакета деградує до
 * `status: 'broken'` для ЦЬОГО пакета — решта пакетів прогону обробляються далі,
 * увесь прогін ніколи не падає через один зламаний пакет.
 *
 * Викликається зі скіла (`npm/skills/storybook/SKILL.md`, `--adopt`):
 *   bun node_modules/@7n/rules-lang-js/rules/storybook/adopt/main.mjs [--fix-missing] [--cwd <path>] [rootDir...]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { isRunAsCli } from '@7n/rules/scripts/cli-entry.mjs'

import { collectInScopeVuePackages } from '../scope/main.mjs'
import {
  APP_MAIN_JS_MARKERS,
  APP_PREVIEW_JS_MARKERS,
  MAIN_JS_MARKERS,
  missingMarkers,
  PREVIEW_JS_MARKERS,
  STORYBOOK_SCRIPT
} from '../scaffold/main.mjs'
import {
  renderAppMainJs,
  renderAppPreviewJs,
  renderEmptyViteConfig,
  renderMainJs,
  renderMocksGqlSse,
  renderPreviewJs,
  renderVitestSetupJs
} from '../scaffold/fix-scaffold.mjs'
import { buildFreshVitestConfig, buildStrykerConfig } from '../vitest-config/fix-vitest-config.mjs'
import {
  AUTO_IMPORT_PLUGIN_RE,
  BROWSER_KEY_RE,
  CHROMIUM_RE,
  classifyProjects,
  findProperty,
  findTestObject,
  hasStoriesMarker,
  parseModule,
  PROVIDER_FACTORY_RE,
  QUASAR_PLUGIN_RE,
  resolveVitestConfigPath,
  strykerConfigPathFor,
  VITE_PLUGIN_PAGES_RE
} from '../vitest-config/main.mjs'

/** Статуси однієї секції діагностики (діагностика ≠ lint-violation — тут завжди 4 значення). */
export const STATUS = Object.freeze({ MATCH: 'match', DIFFER: 'differ', MISSING: 'missing' })

/** Канонічні назви секцій (стабільні — на них зав'язаний `--fix-missing`-switch). */
export const SECTION = Object.freeze({
  MAIN_JS: 'main.js',
  PREVIEW_JS: 'preview.js',
  EMPTY_VITE_CONFIG: 'empty-vite.config.js',
  MOCKS_GQL_SSE: 'mocks/gql-sse.js',
  VITEST_SETUP_JS: 'vitest.setup.js',
  FIXTURES_DIR: '.storybook/fixtures/',
  PACKAGE_SCRIPT: 'package.json#scripts.storybook',
  VITEST_PROJECTS: 'vitest test.projects (unit+storybook)',
  STRYKER_CONFIG: 'vitest.stryker.config'
})

/**
 * posix-relative шлях файлу пакета від кореня репозиторію (для звіту/сообщений).
 * @param {{ rootDir: string }} entry запис пакета
 * @param {string} suffix шлях файлу відносно кореня пакета
 * @returns {string} відносний шлях від кореня репозиторію
 */
function relFileFor(entry, suffix) {
  return entry.rootDir === '.' ? suffix : `${entry.rootDir}/${suffix}`
}

/**
 * Діагностика файлу, канон якого перевіряється текстовими маркерами (main.js/preview.js).
 * @param {{ absDir: string, rootDir: string }} entry запис пакета
 * @param {string} relPath шлях файлу відносно кореня пакета (`.storybook/main.js`)
 * @param {string} sectionName ім'я секції звіту
 * @param {{ token: string, hint: string }[]} markers канонічні маркери файлу
 * @returns {{ name: string, file: string, status: string, detail?: string }} одна секція діагностики
 */
function diagnoseMarkerFile(entry, relPath, sectionName, markers) {
  const file = relFileFor(entry, relPath)
  const abs = join(entry.absDir, relPath)
  if (!existsSync(abs)) return { name: sectionName, file, status: STATUS.MISSING }
  const content = readFileSync(abs, 'utf8')
  const missing = missingMarkers(content, markers)
  if (missing.length === 0) return { name: sectionName, file, status: STATUS.MATCH }
  return {
    name: sectionName,
    file,
    status: STATUS.DIFFER,
    detail: `бракує: ${missing.map(m => m.hint).join(', ')}`
  }
}

/**
 * Діагностика `.storybook/mocks/gql-sse.js` — verbatim-порівняння з канонічним helper-ом
 * (одне джерело істини протоколу graphql-sse, mocking.mdc — не переносити копію в пакет).
 * @param {{ absDir: string, rootDir: string }} entry запис пакета
 * @returns {{ name: string, file: string, status: string, detail?: string }} секція діагностики
 */
function diagnoseMocksSection(entry) {
  const relPath = '.storybook/mocks/gql-sse.js'
  const file = relFileFor(entry, relPath)
  const abs = join(entry.absDir, relPath)
  if (!existsSync(abs)) return { name: SECTION.MOCKS_GQL_SSE, file, status: STATUS.MISSING }
  const actual = readFileSync(abs, 'utf8')
  const canonical = renderMocksGqlSse()
  if (actual === canonical) return { name: SECTION.MOCKS_GQL_SSE, file, status: STATUS.MATCH }
  return {
    name: SECTION.MOCKS_GQL_SSE,
    file,
    status: STATUS.DIFFER,
    detail: 'вміст відрізняється від канонічного helper-а (mocking.mdc) — одне джерело істини, не дублюй логіку вручну'
  }
}

/**
 * Діагностика `.storybook/empty-vite.config.js` — verbatim-порівняння з канонічним
 * стенд-ін файлом (не залежить від пакета, як і `mocks/gql-sse.js`): `main.js` посилається
 * на нього напряму через `core.builder.options.viteConfigPath`, тому розбіжність тут
 * ламає обхід autodiscovery `@storybook/builder-vite`, навіть якщо `main.js` канонічний.
 * @param {{ absDir: string, rootDir: string }} entry запис пакета
 * @returns {{ name: string, file: string, status: string, detail?: string }} секція діагностики
 */
function diagnoseEmptyViteConfigSection(entry) {
  const relPath = '.storybook/empty-vite.config.js'
  const file = relFileFor(entry, relPath)
  const abs = join(entry.absDir, relPath)
  if (!existsSync(abs)) return { name: SECTION.EMPTY_VITE_CONFIG, file, status: STATUS.MISSING }
  const actual = readFileSync(abs, 'utf8')
  const canonical = renderEmptyViteConfig()
  if (actual === canonical) return { name: SECTION.EMPTY_VITE_CONFIG, file, status: STATUS.MATCH }
  return {
    name: SECTION.EMPTY_VITE_CONFIG,
    file,
    status: STATUS.DIFFER,
    detail: 'вміст відрізняється від канонічного стенд-іна (storybook.mdc) — має лишатись порожнім defineConfig({})'
  }
}

/**
 * Діагностика `.storybook/vitest.setup.js` — verbatim-порівняння з канонічним шаблоном
 * (той самий файл для ОБОХ типів пакета, library/app — не залежить від `entry.type`,
 * на відміну від `main.js`/`preview.js`). Без нього `vitest run --project=storybook`
 * не підключає анотації `.storybook/preview.js` (decorators/loaders/parameters).
 * @param {{ absDir: string, rootDir: string }} entry запис пакета
 * @returns {{ name: string, file: string, status: string, detail?: string }} секція діагностики
 */
function diagnoseVitestSetupJsSection(entry) {
  const relPath = '.storybook/vitest.setup.js'
  const file = relFileFor(entry, relPath)
  const abs = join(entry.absDir, relPath)
  if (!existsSync(abs)) return { name: SECTION.VITEST_SETUP_JS, file, status: STATUS.MISSING }
  const actual = readFileSync(abs, 'utf8')
  const canonical = renderVitestSetupJs()
  if (actual === canonical) return { name: SECTION.VITEST_SETUP_JS, file, status: STATUS.MATCH }
  return {
    name: SECTION.VITEST_SETUP_JS,
    file,
    status: STATUS.DIFFER,
    detail: 'вміст відрізняється від канонічного @storybook/addon-vitest-boilerplate (storybook.mdc)'
  }
}

/**
 * Діагностика `.storybook/fixtures/` app-пакета (хвиля 2a) — наявність каталогу з бодай
 * одним файлом. Вміст фікстур — app-специфічні дані (`taskDetailFrame` тощо, ADR-розширення
 * 2026-07-20), без канонічного рендера: `--fix-missing` цю секцію НЕ генерує (на відміну
 * від `mocks/gql-sse.js`), лише сигналізує відсутність — агент/людина пише фікстуру вручну.
 * @param {{ absDir: string, rootDir: string }} entry app-пакет у скоупі
 * @returns {{ name: string, file: string, status: string, detail?: string }} секція діагностики
 */
function diagnoseFixturesSection(entry) {
  const relPath = '.storybook/fixtures'
  const file = relFileFor(entry, relPath)
  const abs = join(entry.absDir, relPath)
  if (!existsSync(abs)) return { name: SECTION.FIXTURES_DIR, file, status: STATUS.MISSING }
  let entries
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    return { name: SECTION.FIXTURES_DIR, file, status: STATUS.MISSING }
  }
  if (entries.every(e => !e.isFile())) {
    return { name: SECTION.FIXTURES_DIR, file, status: STATUS.MISSING, detail: 'каталог порожній' }
  }
  return { name: SECTION.FIXTURES_DIR, file, status: STATUS.MATCH }
}

/**
 * Діагностика `package.json#scripts.storybook`.
 * @param {{ pkg: Record<string, unknown>, rootDir: string }} entry запис пакета
 * @returns {{ name: string, file: string, status: string, detail?: string }} секція діагностики
 */
function diagnoseScriptSection(entry) {
  const file = relFileFor(entry, 'package.json')
  const current = /** @type {{ scripts?: Record<string, unknown> }} */ (entry.pkg)?.scripts?.storybook
  if (current === undefined) return { name: SECTION.PACKAGE_SCRIPT, file, status: STATUS.MISSING }
  if (current === STORYBOOK_SCRIPT) return { name: SECTION.PACKAGE_SCRIPT, file, status: STATUS.MATCH }
  return {
    name: SECTION.PACKAGE_SCRIPT,
    file,
    status: STATUS.DIFFER,
    detail: `зараз '${current}', канон '${STORYBOOK_SCRIPT}'`
  }
}

/**
 * Підказки маркерів storybook-запису `test.projects`, яких бракує — той самий
 * набір (спільні + app-специфічні quasar()/AutoImport()/Pages(), хвиля 2a), що й
 * `vitest-config/main.mjs#collectStorybookMarkerHints` — окрема копія, не імпорт звідти
 * (adopt-діагностика формує людський detail-рядок, а не lint-violation).
 * @param {string} storybookSlice текстовий зріз елемента `storybook` у `test.projects`
 * @param {'library'|'app'} [type] тип пакета
 * @returns {string[]} людські підказки маркерів, яких бракує
 */
function collectAdoptMarkerHints(storybookSlice, type) {
  const missingHints = []
  if (!CHROMIUM_RE.test(storybookSlice)) missingHints.push('chromium-інстанс')
  if (!BROWSER_KEY_RE.test(storybookSlice)) missingHints.push('browser-mode')
  if (!hasStoriesMarker(storybookSlice)) missingHints.push('stories-джерело (include або storybookTest({ configDir }))')
  if (!PROVIDER_FACTORY_RE.test(storybookSlice))
    missingHints.push('provider-factory (playwright() з @vitest/browser-playwright)')
  if (type === 'app') {
    if (!QUASAR_PLUGIN_RE.test(storybookSlice)) missingHints.push('quasar()-плагін')
    if (!AUTO_IMPORT_PLUGIN_RE.test(storybookSlice)) missingHints.push('AutoImport()-плагін')
    if (!VITE_PLUGIN_PAGES_RE.test(storybookSlice)) missingHints.push('Pages()-плагін')
  }
  return missingHints
}

/**
 * Діагностика `test.projects` наявного vitest-конфіга (unit+storybook, browser-mode маркери,
 * плюс для `entry.type === 'app'` — власні quasar()/AutoImport()/Pages()-плагіни, хвиля 2a).
 * @param {{ absDir: string, rootDir: string, type?: 'library'|'app' }} entry запис пакета
 * @returns {{ name: string, file: string, status: string, detail?: string }} секція діагностики
 */
function diagnoseVitestProjectsSection(entry) {
  const name = SECTION.VITEST_PROJECTS
  const vitestConfigPath = resolveVitestConfigPath(entry.absDir)
  if (!vitestConfigPath) {
    return { name, file: relFileFor(entry, 'vitest.config.mjs'), status: STATUS.MISSING }
  }
  const file = relFileFor(entry, vitestConfigPath.slice(entry.absDir.length + 1))
  const src = readFileSync(vitestConfigPath, 'utf8')

  let parsed
  try {
    parsed = parseModule(vitestConfigPath, src)
  } catch (error) {
    return { name, file, status: STATUS.DIFFER, detail: `не парситься (${error.message}) — перевір вручну` }
  }
  if (parsed.errors?.length) {
    return { name, file, status: STATUS.DIFFER, detail: 'syntax error — перевір вручну' }
  }

  const testObj = findTestObject(parsed.program)
  if (!testObj) {
    return { name, file, status: STATUS.DIFFER, detail: 'немає test-блоку (defineConfig({ test: {...} }))' }
  }

  const projectsProp = findProperty(testObj, 'projects')
  if (!projectsProp) {
    return { name, file, status: STATUS.MISSING, detail: 'test.projects відсутній' }
  }
  if (projectsProp.value?.type !== 'ArrayExpression') {
    return { name, file, status: STATUS.DIFFER, detail: 'test.projects не статичний масив (spread/змінна)' }
  }

  const { hasUnit, storybookSlice } = classifyProjects(src, projectsProp.value)
  if (!hasUnit || !storybookSlice) {
    const missingParts = [hasUnit ? null : "'unit'", storybookSlice ? null : "'storybook'"].filter(Boolean)
    return { name, file, status: STATUS.DIFFER, detail: `бракує ${missingParts.join(' і ')} у test.projects` }
  }

  const missingHints = collectAdoptMarkerHints(storybookSlice, entry.type)
  if (missingHints.length > 0) {
    return { name, file, status: STATUS.DIFFER, detail: `storybook-project без: ${missingHints.join(', ')}` }
  }

  return { name, file, status: STATUS.MATCH }
}

/**
 * Діагностика ізольованого `vitest.stryker.config.*` — байтове порівняння з канонічним
 * baseline-рендером (fix-vitest-config.mjs, той самий генератор).
 * @param {{ absDir: string, rootDir: string }} entry запис пакета
 * @returns {Promise<{ name: string, file: string, status: string, detail?: string }>} секція діагностики
 */
async function diagnoseStrykerSection(entry) {
  const name = SECTION.STRYKER_CONFIG
  const vitestConfigPath = resolveVitestConfigPath(entry.absDir)
  if (!vitestConfigPath) {
    return { name, file: relFileFor(entry, 'vitest.stryker.config.mjs'), status: STATUS.MISSING }
  }
  const strykerPath = strykerConfigPathFor(vitestConfigPath)
  const file = relFileFor(entry, strykerPath.slice(entry.absDir.length + 1))
  if (!existsSync(strykerPath)) {
    return { name, file, status: STATUS.MISSING }
  }
  const actual = readFileSync(strykerPath, 'utf8')
  const canonical = await buildStrykerConfig(entry.absDir)
  if (actual === canonical) return { name, file, status: STATUS.MATCH }
  return {
    name,
    file,
    status: STATUS.DIFFER,
    detail:
      'вміст відрізняється від канонічного baseline (vitest-config.mdc) — @stryker-mutator/vitest-runner крашиться на browser-mode projects, перевір вручну'
  }
}

/**
 * Діагностика одного пакета в скоупі по секціях. Розгалужена за `entry.type` (хвиля 2a):
 * app-пакети діагностуються за app-канонічними маркерами й БЕЗ `empty-vite.config.js`
 * (свідома асиметрія — app-и не використовують `viteConfigPath`-обхід), з додатковою
 * секцією `.storybook/fixtures/`. Ніколи не кидає — збій окремої секції (парсинг/IO)
 * відображається як секція `differ`, а не виняток, що впав би на весь пакет; лишається
 * на розсуд `diagnosePackage` (circuit breaker рівня пакета — тут не потрібен, бо секції
 * вже ізольовані одна від одної).
 * @param {import('../scope/main.mjs').InScopePackage} entry пакет у скоупі
 * @returns {Promise<{ rootDir: string, status: 'canonical'|'missing-files'|'differs', sections: object[] }>} діагностика пакета
 */
export async function diagnosePackage(entry) {
  const isApp = entry.type === 'app'
  const sections = [
    diagnoseMarkerFile(entry, '.storybook/main.js', SECTION.MAIN_JS, isApp ? APP_MAIN_JS_MARKERS : MAIN_JS_MARKERS),
    diagnoseMarkerFile(
      entry,
      '.storybook/preview.js',
      SECTION.PREVIEW_JS,
      isApp ? APP_PREVIEW_JS_MARKERS : PREVIEW_JS_MARKERS
    ),
    ...(isApp ? [] : [diagnoseEmptyViteConfigSection(entry)]),
    diagnoseMocksSection(entry),
    diagnoseVitestSetupJsSection(entry),
    ...(isApp ? [diagnoseFixturesSection(entry)] : []),
    diagnoseScriptSection(entry),
    diagnoseVitestProjectsSection(entry),
    await diagnoseStrykerSection(entry)
  ]
  let status = 'canonical'
  if (sections.some(s => s.status === STATUS.DIFFER)) status = 'differs'
  else if (sections.some(s => s.status === STATUS.MISSING)) status = 'missing-files'
  return { rootDir: entry.rootDir, status, sections }
}

/**
 * Генерує канонічний вміст лише для секцій зі статусом `missing` одного пакета
 * (adopt-автофікс НІКОЛИ не чіпає секції зі статусом `differ` — інструкція
 * для агента/людини, не сліпий перезапис). Кожна секція фіксується незалежно;
 * збій однієї не блокує решту (той самий circuit-breaker принцип, лише на дрібнішому рівні).
 * `.storybook/fixtures/` (app-пакети) свідомо не генерується тут — вміст app-специфічний,
 * канонічного рендера немає ({@link diagnoseFixturesSection}).
 * @param {import('../scope/main.mjs').InScopePackage} entry пакет у скоупі
 * @param {object[]} sections секції діагностики пакета (`diagnosePackage().sections`)
 * @returns {Promise<string[]>} абсолютні шляхи записаних файлів
 */
export async function fixMissingSections(entry, sections) {
  const written = []
  const writeFileEnsureDir = (absPath, content) => {
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, content, 'utf8')
    written.push(absPath)
  }

  const byName = new Map(sections.map(s => [s.name, s]))
  const isApp = entry.type === 'app'

  if (byName.get(SECTION.MAIN_JS)?.status === STATUS.MISSING) {
    const content = isApp ? renderAppMainJs() : renderMainJs(entry.absDir)
    writeFileEnsureDir(join(entry.absDir, '.storybook/main.js'), content)
  }
  if (byName.get(SECTION.PREVIEW_JS)?.status === STATUS.MISSING) {
    const content = isApp ? renderAppPreviewJs() : renderPreviewJs()
    writeFileEnsureDir(join(entry.absDir, '.storybook/preview.js'), content)
  }
  if (!isApp && byName.get(SECTION.EMPTY_VITE_CONFIG)?.status === STATUS.MISSING) {
    writeFileEnsureDir(join(entry.absDir, '.storybook/empty-vite.config.js'), renderEmptyViteConfig())
  }
  if (byName.get(SECTION.MOCKS_GQL_SSE)?.status === STATUS.MISSING) {
    writeFileEnsureDir(join(entry.absDir, '.storybook/mocks/gql-sse.js'), renderMocksGqlSse())
  }
  if (byName.get(SECTION.VITEST_SETUP_JS)?.status === STATUS.MISSING) {
    writeFileEnsureDir(join(entry.absDir, '.storybook/vitest.setup.js'), renderVitestSetupJs())
  }
  if (byName.get(SECTION.PACKAGE_SCRIPT)?.status === STATUS.MISSING) {
    const pkgPath = join(entry.absDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
    pkg.scripts.storybook = STORYBOOK_SCRIPT
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    written.push(pkgPath)
  }
  if (byName.get(SECTION.VITEST_PROJECTS)?.status === STATUS.MISSING && !resolveVitestConfigPath(entry.absDir)) {
    // test.projects відсутній ЛИШЕ через відсутність усього vitest-конфіга — augment
    // наявного (без відсутнього test-блоку) свідомо поза adopt-автофіксом: секція вже
    // позначена `differ` (не `missing`) для такого випадку, сюди він не потрапляє.
    const fresh = await buildFreshVitestConfig(entry.absDir, entry.type)
    writeFileEnsureDir(fresh.path, fresh.content)
  }
  if (byName.get(SECTION.STRYKER_CONFIG)?.status === STATUS.MISSING) {
    const vitestConfigPath = resolveVitestConfigPath(entry.absDir) ?? join(entry.absDir, 'vitest.config.mjs')
    const strykerPath = strykerConfigPathFor(vitestConfigPath)
    writeFileEnsureDir(strykerPath, await buildStrykerConfig(entry.absDir))
  }

  return written
}

/**
 * Adopt-прогін усіх (чи обраних) пакетів у скоупі. Circuit breaker (ADR Кластер 8):
 * збій діагностики/фіксу ОДНОГО пакета деградує до `status: 'broken'` для нього —
 * решта пакетів обробляються далі, весь прогін ніколи не падає через один зламаний.
 * @param {string} cwd абсолютний корінь консюмер-репо
 * @param {{ fixMissing?: boolean, rootDirs?: string[] }} [opts] `fixMissing` — генерувати
 *   відсутні секції; `rootDirs` — звузити прогін до цих коренів пакетів (порожньо/відсутнє → усі в скоупі)
 * @returns {Promise<{ rootDir: string, status: string, sections?: object[], written?: string[], error?: string }[]>} результати за пакетами
 */
export async function runAdopt(cwd, opts = {}) {
  const fixMissing = opts.fixMissing === true
  const wantedRoots = Array.isArray(opts.rootDirs) && opts.rootDirs.length > 0 ? new Set(opts.rootDirs) : null

  const allPkgs = await collectInScopeVuePackages(cwd)
  const pkgs = wantedRoots ? allPkgs.filter(p => wantedRoots.has(p.rootDir)) : allPkgs

  const results = []
  for (const entry of pkgs) {
    try {
      const diagnosis = await diagnosePackage(entry)
      const written = fixMissing ? await fixMissingSections(entry, diagnosis.sections) : []
      results.push({ ...diagnosis, written })
    } catch (error) {
      results.push({
        rootDir: entry.rootDir,
        status: 'broken',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return results
}

/** Іконка статусу пакета (`package.status`) для рядка звіту. */
const PACKAGE_STATUS_ICONS = Object.freeze({ canonical: '✅', 'missing-files': '➕' })
/** Іконка статусу секції (`STATUS.*`) для рядка звіту. */
const SECTION_STATUS_ICONS = Object.freeze({ [STATUS.MATCH]: '  ✓', [STATUS.MISSING]: '  +' })

/**
 * Рядки звіту одного НЕ зламаного пакета (статус + секції + перелік згенерованого).
 * @param {{ rootDir: string, status: string, sections: object[], written?: string[] }} r результат одного пакета
 * @returns {string[]} рядки звіту
 */
function formatPackageLines(r) {
  const label = r.rootDir === '.' ? 'корінь' : r.rootDir
  const lines = [`${PACKAGE_STATUS_ICONS[r.status] ?? '⚠️ '} [${label}] ${r.status}`]
  for (const s of r.sections) {
    const sIcon = SECTION_STATUS_ICONS[s.status] ?? '  ✗'
    const suffix = s.detail ? ` — ${s.detail}` : ''
    lines.push(`${sIcon} ${s.name} (${s.file}): ${s.status}${suffix}`)
  }
  if (r.written && r.written.length > 0) {
    lines.push(`  згенеровано: ${r.written.join(', ')}`)
  }
  return lines
}

/**
 * Форматує людський звіт по результатах `runAdopt` (українською, для виводу скіла в CLI).
 * @param {Awaited<ReturnType<typeof runAdopt>>} results результати `runAdopt`
 * @returns {string} багаторядковий текстовий звіт
 */
export function formatReport(results) {
  if (results.length === 0) {
    return 'storybook adopt: немає Vue component library пакетів у скоупі (storybook.mdc → scope/main.mjs)'
  }
  const lines = []
  for (const r of results) {
    if (r.status === 'broken') {
      const label = r.rootDir === '.' ? 'корінь' : r.rootDir
      lines.push(`⚠️  [${label}] діагностика впала (circuit breaker, пропущено): ${r.error}`)
      continue
    }
    lines.push(...formatPackageLines(r))
  }
  return lines.join('\n')
}

/**
 * CLI-вхід: `bun .../storybook/adopt/main.mjs [--fix-missing] [--cwd <path>] [rootDir...]`.
 * @returns {Promise<void>} завершення прогону (друкує звіт, exit-код — кількість `differs`/`broken`)
 */
async function runCli() {
  const args = process.argv.slice(2)
  const fixMissing = args.includes('--fix-missing')
  const cwdIdx = args.indexOf('--cwd')
  const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? args[cwdIdx + 1] : process.cwd()
  const rootDirs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--cwd')

  const results = await runAdopt(cwd, { fixMissing, rootDirs })
  console.log(formatReport(results))
  const hasIssues = results.some(r => r.status === 'differs' || r.status === 'broken')
  process.exitCode = hasIssues ? 1 : 0
}

if (isRunAsCli(import.meta.url)) {
  await runCli()
}
