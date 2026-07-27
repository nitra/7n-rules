/**
 * Витягує PHP docblock-и (`/** ... *​/` над class/interface/trait/enum/function/public
 * method) для дослівної doc-files-документації — аналог `lang-python/doc-files/extractors.mjs`,
 * але без AST/парсера PHP: чистий рядковий скан регулярними виразами, без зовнішніх
 * залежностей і без запуску `php`.
 * @see ./docs/extractors.md
 */

/** Top-level `class`/`interface`/`trait`/`enum` (з опційними `abstract`/`final`). */
const TYPE_DECL_RE = /^(?:abstract\s+|final\s+)?(class|interface|trait|enum)\s+([A-Za-z_]\w*)/
/** `function` з опційним відступом і модифікаторами видимості/`static`/`abstract`/`final`. */
const FUNC_DECL_RE = /^(\s*)((?:(?:abstract|final|public|protected|private|static)\s+)*)function\s+&?([A-Za-z_]\w*)/
/** Рядок-атрибут PHP 8 (`#[Route(...)]`) — пропускається між docblock-ом і декларацією. */
const ATTRIBUTE_RE = /^\s*#\[/
/** Рядки на початку файлу, що не є file-level docblock-ом, але не зупиняють пошук. */
const HEADER_SKIP_RE = /^(?:#!|\s*$|<\?php\b|declare\s*\(|(?:namespace|use)\s+[\w\\]+|#\[)/i
const WRITE_RE = /\b(?:fopen\([^)]*,\s*['"][waxc]|file_put_contents|fwrite|fputs|unlink\(|rmdir\(|mkdir\(|rename\()/i
const NETWORK_RE =
  /\b(?:curl_init|curl_exec|fsockopen|stream_socket_client|socket_create|GuzzleHttp|Http\\Client|file_get_contents\(\s*['"]https?:)/i
const CACHE_RE = /\b(?:cache|cached|memoize|apcu_\w+)\b/i
const EXCEPT_RE = /\bcatch\s*\(/
const EXCEPT_RETURNS_FALSY_RE = /\bcatch\s*\([^)]*\)\s*\{[\s\S]{0,400}?\breturn\s+(?:null|false|'')/i
/** Використовуй-import (`use App\Foo;` / `use function …;` / `use const …;`) на початку рядка. */
const USE_IMPORT_RE = /^use\s+(?:function\s+|const\s+)?([\w\\]+)/gm
/** `*`-облямівка рядка всередині docblock-у. */
const STAR_PREFIX_RE = /^\s*\*\s?/
/** Початок PHPDoc-тегу (`@param`, `@return`, …). */
const TAG_LINE_RE = /^@[A-Za-z]/
/** Кінець рядка — закриття блок-коментаря (`*​/`). */
const BLOCK_COMMENT_END_RE = /\*\/\s*$/
/** Модифікатори видимості `private`/`protected` у сигнатурі методу. */
const NON_PUBLIC_MODIFIER_RE = /\b(?:private|protected)\b/
/** Модифікатор видимості `public` у сигнатурі методу. */
const PUBLIC_MODIFIER_RE = /\bpublic\b/

/**
 * Нормалізує вміст docblock-у для Markdown: знімає `*`-облямівку кожного рядка, зберігає
 * абзаци, обриває опис на першому тезі (`@param`, `@return`, …) — тези не рендеряться дослівно.
 * @param {string[]} rawLines рядки між `/**` і `*​/` (без самих маркерів)
 * @returns {string} текст без спільної облямівки та без тегів
 */
function cleanDocblock(rawLines) {
  const descLines = []
  for (const raw of rawLines) {
    const line = raw.replace(STAR_PREFIX_RE, '').trim()
    if (TAG_LINE_RE.test(line)) break
    descLines.push(line)
  }
  while (descLines.length && !descLines.at(-1)) descLines.pop()
  while (descLines.length && !descLines[0]) descLines.shift()
  return descLines.join('\n')
}

/**
 * Читає блок-коментар `/** ... *​/`, що починається на заданому рядку.
 * @param {string[]} lines рядки PHP-файлу
 * @param {number} start індекс рядка з відкривальним `/**`
 * @returns {{ raw:string[], end:number }|null} внутрішні рядки і рядок закриття
 */
function readBlockComment(lines, start) {
  const first = lines[start]
  const openIdx = first.indexOf('/**')
  if (openIdx === -1) return null
  const afterOpen = first.slice(openIdx + 3)
  const closeIdxSame = afterOpen.indexOf('*/')
  if (closeIdxSame !== -1) return { raw: [afterOpen.slice(0, closeIdxSame)], end: start }
  const body = afterOpen.trim() ? [afterOpen] : []
  for (let i = start + 1; i < lines.length; i++) {
    const closeIdx = lines[i].indexOf('*/')
    if (closeIdx !== -1) {
      body.push(lines[i].slice(0, closeIdx))
      return { raw: body, end: i }
    }
    body.push(lines[i])
  }
  return null
}

/**
 * Docblock, що стоїть безпосередньо перед декларацією (крізь порожні рядки й атрибути).
 * @param {string[]} lines рядки PHP-файлу
 * @param {number} declLine індекс рядка декларації
 * @returns {string} авторський опис або порожній рядок
 */
function docblockBeforeLine(lines, declLine) {
  let i = declLine - 1
  while (i >= 0 && (!lines[i].trim() || ATTRIBUTE_RE.test(lines[i]))) i--
  if (i < 0 || !BLOCK_COMMENT_END_RE.test(lines[i].trimEnd())) return ''
  let start = i
  while (start >= 0 && !lines[start].includes('/**')) start--
  if (start < 0) return ''
  const block = readBlockComment(lines, start)
  if (!block || block.end !== i) return ''
  return cleanDocblock(block.raw)
}

/**
 * File-level docblock: перший значущий рядок файлу (після `<?php`, `declare`, `namespace`,
 * `use`, атрибутів), якщо це `/** ... *​/` — як у python/doc_comments rule для module docstring.
 * Якщо перший docblock фактично належить першій декларації (клас одразу під ним), значення
 * все одно повертається дослівно — це чесний збіг вихідного тексту, а не вигадана різниця.
 * @param {string[]} lines рядки PHP-файлу
 * @returns {string} авторський опис файлу або порожній рядок
 */
function fileDocblock(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_SKIP_RE.test(lines[i])) continue
    const block = readBlockComment(lines, i)
    return block ? cleanDocblock(block.raw) : ''
  }
  return ''
}

/**
 * Витягує top-level `class`/`interface`/`trait`/`enum`, top-level `function` і явно
 * `public`-методи разом з їхніми docblock-ами. `private`/`protected` і методи без явного
 * модифікатора видимості свідомо пропускаються — чесніше не вгадувати видимість, ніж
 * помилково видати implicit-public за задокументований контракт.
 * @param {string[]} lines рядки PHP-файлу
 * @returns {Array<{name:string,kind:string,desc:string}>} public API
 */
function collectExports(lines) {
  const exports = []
  for (const [line, text] of lines.entries()) {
    const typeMatch = text.match(TYPE_DECL_RE)
    if (typeMatch) {
      exports.push({ name: typeMatch[2], kind: typeMatch[1], desc: docblockBeforeLine(lines, line) })
      continue
    }
    const funcMatch = text.match(FUNC_DECL_RE)
    if (!funcMatch) continue
    const [, indent, modifiersRaw, name] = funcMatch
    const modifiers = modifiersRaw.trim()
    if (NON_PUBLIC_MODIFIER_RE.test(modifiers)) continue
    if (PUBLIC_MODIFIER_RE.test(modifiers)) {
      exports.push({ name, kind: 'method', desc: docblockBeforeLine(lines, line) })
    } else if (!modifiers && indent === '') {
      exports.push({ name, kind: 'function', desc: docblockBeforeLine(lines, line) })
    }
  }
  return exports
}

/**
 * Витягує факт-лист PHP без парсера/запуску `php`: file-level і per-декларація docblock-и
 * стають авторитетними полями `header` та `exports` для zero-LLM doc-files.
 * @param {string} src вміст PHP-файлу
 * @param {string} relPath відносний шлях
 * @returns {object} факт-лист для doc-files
 */
export function extractFactsPhp(src, relPath) {
  const lines = src.split('\n')
  const exports = collectExports(lines)
  const imports = Array.from(src.matchAll(USE_IMPORT_RE), match => match[1])
  return {
    relPath,
    lang: 'php',
    header: fileDocblock(lines),
    exports,
    imports: { stdlib: [], external: imports, internal: [] },
    internalSymbols: [],
    localSymbols: [],
    markers: {
      readOnly: !WRITE_RE.test(src),
      catchesErrors: EXCEPT_RE.test(src),
      returnsFalsyOnFail: EXCEPT_RETURNS_FALSY_RE.test(src),
      network: NETWORK_RE.test(src),
      caches: CACHE_RE.test(src),
      skips: []
    }
  }
}

/** Handler extension-point `doc-files` для PHP. */
const phpDocFilesExtractor = {
  id: 'php',
  extensions: ['.php'],
  extractFacts: extractFactsPhp
}

/**
 * Експортує PHP extractor як default extension-point для doc-files.
 */
export default phpDocFilesExtractor
