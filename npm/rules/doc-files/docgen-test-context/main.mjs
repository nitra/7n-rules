/**
 * @see ./docs/main.md
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

import { isDocgenIgnored } from '../docgen-ignore/main.mjs'

const JS_TEST_RE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u
const RELATIVE_LITERAL_RE = /(['"])(\.{1,2}\/[^'"\n]+)\1/gu
const SCENARIO_RE = /\b(?:describe|test|it)\s*\(\s*['"`]([^'"`\n]{1,200})['"`]/gu
const QUERY_OR_HASH_RE = /[?#]/u
const SOURCE_EXTENSIONS = Object.freeze(['.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.vue', '.py', '.rs'])
const TEST_SUFFIX_RE = /\.(?:test|spec)$/u

/**
 * Чи шлях має форму окремого test/spec-файлу, який може описувати usage-сценарії.
 * Rust unit-тести всередині source-файлу вже входять до самого джерела.
 * @param {string} fileName basename файлу
 * @returns {boolean} true для JS/TS test/spec та Python test-файлів
 */
export function isDocgenTestFile(fileName) {
  const pythonTest = fileName.endsWith('.py') && (fileName.startsWith('test_') || fileName.endsWith('_test.py'))
  return JS_TEST_RE.test(fileName) || pythonTest
}

/**
 * Рекурсивно знаходить test/spec-файли, поважаючи те саме ignore-дерево, що й doc-files.
 * @param {string} root корінь репозиторію
 * @returns {string[]} абсолютні шляхи у стабільному порядку
 */
function collectTestFiles(root) {
  const out = []

  /** @param {string} dir поточний каталог */
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (entry.isDirectory()) {
        if (!isDocgenIgnored(rel, 'dir')) walk(abs)
      } else if (entry.isFile() && isDocgenTestFile(entry.name) && !isDocgenIgnored(rel)) {
        out.push(abs)
      }
    }
  }

  walk(root)
  return out.toSorted()
}

/**
 * Повертає наявний файл для relative module specifier-а з test-файлу.
 * Підтримує explicit extension, import без розширення і directory index.
 * @param {string} testAbs абсолютний шлях тесту
 * @param {string} specifier relative specifier із рядкового літерала
 * @returns {string|null} абсолютний шлях referenced-файлу
 */
function resolveRelativeReference(testAbs, specifier) {
  const clean = specifier.split(QUERY_OR_HASH_RE, 1)[0]
  const base = resolve(dirname(testAbs), clean)
  const candidates = [base]
  if (!extname(base)) {
    for (const ext of SOURCE_EXTENSIONS) candidates.push(base + ext)
    for (const ext of SOURCE_EXTENSIONS) candidates.push(join(base, `index${ext}`))
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return resolve(candidate)
    } catch {
      // Файл міг зникнути між existsSync/statSync — такий reference не беремо.
    }
  }
  return null
}

/**
 * Витягує файли, на які test/spec посилається relative string literal-ом.
 * Це охоплює static/dynamic import, require, vi.mock та аналогічні API без
 * прив'язки до конкретного test runner-а.
 * @param {string} testAbs абсолютний шлях тесту
 * @param {string} content вміст тесту
 * @returns {string[]} абсолютні referenced-файли
 */
function referencedFiles(testAbs, content) {
  const out = new Set()
  for (const match of content.matchAll(RELATIVE_LITERAL_RE)) {
    const referenced = resolveRelativeReference(testAbs, match[2])
    if (referenced) out.add(referenced)
  }
  return [...out]
}

/**
 * Відсіює helper imports: relative reference є необхідним, але не достатнім
 * доказом, що тест описує поведінку саме цього source. Додатково вимагається
 * naming (`foo.test` → `foo`) або module layout (`module/tests/*` → main/index).
 * @param {string} testAbs абсолютний шлях тесту
 * @param {string} sourceAbs абсолютний шлях referenced source
 * @returns {boolean} true, якщо тест із високою ймовірністю є тестом source
 */
function isLikelyTestSubject(testAbs, sourceAbs) {
  const testStem = basename(testAbs, extname(testAbs)).replace(TEST_SUFFIX_RE, '')
  const sourceStem = basename(sourceAbs, extname(sourceAbs))
  if (testStem === sourceStem) return true
  if (sourceStem !== 'main' && sourceStem !== 'index') return false
  const sourceDir = dirname(sourceAbs)
  const testRel = relative(sourceDir, testAbs).split(sep).join('/')
  return testStem === basename(sourceDir) || testRel.startsWith('tests/')
}

/**
 * Будує один source↔tests index на репозиторій. Зв'язок вважається доведеним
 * лише через relative string literal, що резолвиться у реальний файл.
 * @param {string} root корінь репозиторію
 * @returns {{ root: string, bySource: Map<string, Array<{absPath:string,relPath:string,content:string}>>, byTest: Map<string,string[]> }} source↔tests index
 */
export function buildTestEvidenceIndex(root) {
  const normalizedRoot = resolve(root)
  const bySource = new Map()
  const byTest = new Map()
  for (const testAbs of collectTestFiles(normalizedRoot)) {
    let content
    try {
      content = readFileSync(testAbs, 'utf8')
    } catch {
      continue
    }
    const relPath = relative(normalizedRoot, testAbs).split(sep).join('/')
    const sources = referencedFiles(testAbs, content).filter(sourceAbs => isLikelyTestSubject(testAbs, sourceAbs))
    byTest.set(testAbs, sources)
    for (const sourceAbs of sources) {
      const tests = bySource.get(sourceAbs) ?? []
      tests.push({ absPath: testAbs, relPath, content })
      bySource.set(sourceAbs, tests)
    }
  }
  return { root: normalizedRoot, bySource, byTest }
}

/**
 * Витягує назви describe/test/it як короткі підтверджені usage-сценарії.
 * @param {string} content вміст тесту
 * @returns {string[]} унікальні назви у порядку появи
 */
function scenarioNames(content) {
  return [...new Set(Array.from(content.matchAll(SCENARIO_RE), match => match[1].trim()).filter(Boolean))]
}

/**
 * Формує дані для JS-рендеру сценаріїв і детермінований payload для CRC.
 * Test-код не потрапляє до LLM prompt: опис тестового usage лишається дослівним.
 * @param {string} sourceAbs абсолютний шлях source-файлу
 * @param {ReturnType<typeof buildTestEvidenceIndex>} index source↔tests index
 * @returns {{ files: Array<{path:string,scenarios:string[]}>, crcPayload:string }} сценарії і повний CRC payload
 */
export function testEvidenceForSource(sourceAbs, index) {
  const tests = index.bySource.get(resolve(sourceAbs)) ?? []
  if (tests.length === 0) return { files: [], crcPayload: '' }

  const files = tests.map(test => ({ path: test.relPath, scenarios: scenarioNames(test.content) }))
  const crcPayload = tests.map(test => `\0${test.relPath}\0${test.content}`).join('')
  return { files, crcPayload }
}

/**
 * Детерміновано рендерить підтверджені тестами сценарії у Markdown. Назви
 * походять безпосередньо з `describe`/`test`/`it`, тому LLM не може їх
 * перефразувати або додати неіснуючу поведінку.
 * @param {Array<{path:string, scenarios:string[]}>} files повʼязані test-файли зі сценаріями
 * @returns {string} вміст секції «Сценарії використання» без заголовка
 */
export function renderTestScenarios(files) {
  return files.flatMap(test => test.scenarios.map(scenario => `- \`${test.path}\` — ${scenario}`)).join('\n')
}

/**
 * Source-файли, на які посилається конкретний змінений test/spec-файл.
 * @param {string} testAbs абсолютний шлях тесту
 * @param {ReturnType<typeof buildTestEvidenceIndex>} index source↔tests index
 * @returns {string[]} абсолютні source-шляхи
 */
export function sourceFilesForTest(testAbs, index) {
  return index.byTest.get(resolve(testAbs)) ?? []
}
