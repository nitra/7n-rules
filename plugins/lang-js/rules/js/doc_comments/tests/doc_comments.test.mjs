import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { patterns, promoteLineBlock } from '../fix-doc_comments.mjs'

// Фікстури зібрані динамічно, щоб цей файл сам не тригерив власний детектор.
const lineComment = text => `// ${text}`

let dir
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/**
 * Створює tmp-проєкт із файлами.
 * @param {Record<string, string>} files відносний шлях → вміст
 * @returns {string} корінь tmp-проєкту
 */
function makeProject(files) {
  dir = mkdtempSync(join(tmpdir(), 'doc-comments-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

/**
 * Ручна конструкція promotable-violation для T0-патерну: замінює
 * `checkFileDocComments` (видалений разом з `main.mjs`) — офсети рахуються
 * прямо через `indexOf` над РЕАЛЬНИМ вмістом файлу, той самий формат
 * `data`, що видавав детектор (`{ start, end, promotable: true }`).
 * @param {string} content вміст файлу
 * @param {string} block точний текст `//`-блоку всередині `content`
 * @param {string} file шлях файлу (як у `LintViolation.file`)
 * @returns {{ reason: string, file: string, data: { start: number, end: number, promotable: true } }} violation
 */
function promotableViolation(content, block, file) {
  const start = content.indexOf(block)
  if (start === -1) throw new Error(`фікстура-помилка: блок "${block}" не знайдено в content`)
  return { reason: 'missing-file-header', file, data: { start, end: start + block.length, promotable: true } }
}

// Детектор («check js.doc_comments») цього файлу видалено разом з
// `main.mjs` — JS-фолбек кластера `js/*` прибрано, канон тепер
// `detect_doc_comments`/`check_file_doc_comments` у
// `crates/plugin-lang-js/src/lib.rs` (секція «Зріз 4 контракту v3.1»,
// зокрема `detect_doc_comments_emits_utf16_offsets_not_byte_offsets`,
// `detect_doc_comments_reports_header_and_each_export`,
// `detect_doc_comments_skips_files_without_exports_and_broken_syntax`,
// `detect_doc_comments_accepts_jsdoc_header_after_shebang`,
// `detect_doc_comments_blank_line_breaks_promotable_link`,
// `is_doc_comment_target_mirrors_js_predicate` — повний 1:1 еквівалент усіх
// сценаріїв, що були тут). Detect+fix round-trip (wasm-детект → JS-фікс)
// перевіряє `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity.test.mjs`
// (`describe('wasm-plugin parity — js/doc_comments (T0-фікс: …)')`).
//
// Тут лишається лише fix-половина (T0-фіксер — свідома JS-прогалина
// host-мосту, §2.3 реєстру `docs/plans/2026-08-05-open-questions-register.md`):
// violations конструюються вручну (реальні UTF-16-офсети через `indexOf`),
// без залежності від видаленого детектора.

describe('fix js.doc_comments — T0 підвищення // → JSDoc', () => {
  test('promoteLineBlock: символ закриття коментаря у тексті екранується — JSDoc не рветься', () => {
    const closer = ['*', '/'].join('')
    const out = promoteLineBlock(`// glob npm/*${closer}.js (не .mjs)`, '')
    // Єдине незаекрановане закриття — фінальний JSDoc-термінатор.
    expect(out.split(closer)).toHaveLength(2)
    expect(out).toContain(String.raw`*\/`)
  })

  test('promoteLineBlock: один рядок і багаторядковий блок', () => {
    expect(promoteLineBlock(lineComment('робить X'), '')).toBe('/** робить X */')
    const multi = [lineComment('перший'), lineComment('другий')].join('\n')
    expect(promoteLineBlock(multi, '')).toBe(['/**', ' * перший', ' * другий', ' */'].join('\n'))
  })

  test('apply: блок над експортом стає JSDoc', async () => {
    const headerBlock = lineComment('намір файлу')
    const exportBlock = lineComment('робить X')
    const src = [headerBlock, '', exportBlock, 'export function go() {}', ''].join('\n')
    const cwd = makeProject({ 'src/a.mjs': src })
    const before = [
      promotableViolation(src, headerBlock, 'src/a.mjs'),
      promotableViolation(src, exportBlock, 'src/a.mjs')
    ]

    const writes = []
    await patterns[0].apply(before, {
      cwd,
      recordWrite: p => {
        writes.push(p)
      }
    })
    const after = readFileSync(join(cwd, 'src/a.mjs'), 'utf8')
    expect(writes).toHaveLength(1)
    expect(after).toContain('/** намір файлу */')
    expect(after).toContain('/** робить X */')
  })

  test('apply: несвіжі офсети (файл уже підвищено) — no-op, файл не псується', async () => {
    // Продакшн-сценарій: `applyT0` ганяє ВСІ патерни концерну одним масивом
    // violations, тож після wasm-плану (`wasm-fix:js/doc_comments`) цей
    // фіксер бачить уже підвищений `/** … */` за тими самими офсетами.
    const headerBlock = lineComment('намір файлу')
    const exportBlock = lineComment('робить X')
    const src = [headerBlock, '', exportBlock, 'export function go() {}', ''].join('\n')
    const cwd = makeProject({ 'src/a.mjs': src })
    const v = [promotableViolation(src, headerBlock, 'src/a.mjs'), promotableViolation(src, exportBlock, 'src/a.mjs')]
    await patterns[0].apply(v, { cwd })
    const promoted = readFileSync(join(cwd, 'src/a.mjs'), 'utf8')

    const res = await patterns[0].apply(v, { cwd })
    expect(res.touchedFiles).toEqual([])
    expect(readFileSync(join(cwd, 'src/a.mjs'), 'utf8')).toBe(promoted)
  })

  test('apply: не-promotable порушення не чіпаються', async () => {
    const src = 'export function go() {}\n'
    const cwd = makeProject({ 'src/a.mjs': src })
    // `data` без `promotable` — той самий формат, що детектор видає для
    // невіддільного (не впритул до `//`-блоку) порушення.
    const v = [{ reason: 'missing-export-doc', file: 'src/a.mjs', data: { name: 'go' } }]
    const writes = []
    const res = await patterns[0].apply(v, {
      cwd,
      recordWrite: p => {
        writes.push(p)
      }
    })
    expect(writes).toEqual([])
    expect(res.touchedFiles).toEqual([])
    expect(readFileSync(join(cwd, 'src/a.mjs'), 'utf8')).toBe(src)
  })
})
