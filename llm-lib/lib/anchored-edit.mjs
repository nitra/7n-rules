/** @see ./docs/anchored-edit.md */

/**
 * Hash-anchored line-editing (Фаза A2 run-harness, дизайн 2026-07-11).
 *
 * Строга заміна built-in `read`/`edit` для fix-профілів: кожен рядок файлу має
 * 3-символьний base36-якір від хешу вмісту; правка застосовується ЛИШЕ якщо якір
 * збігається з поточним вмістом рядка. Жодного fuzzy-match, мовчазного переміщення
 * чи автокорекції (клас collateral слабких моделей: переписаний файл, літеральний
 * `\n\n`). Будь-який mismatch → структурована відмова `stale anchor` БЕЗ часткового
 * застосування (атомарно на файл) — агенту лишається перечитати файл і повторити.
 *
 * Референс патерну — pi-hashline-edit-pro (вендоримо ідею, не пакет: рішення Б спеки
 * pi-harness-mt-fix-graph). Хеш — `node:crypto` sha256-префікс (нуль нових залежностей;
 * контекст не sensitive — якір лише детектує розбіжність вмісту рядка).
 *
 * Модуль pi-free: чисті функції над рядками + фабрика tool-дефініцій, якій caller
 * (agent-fix) передає pi `defineTool` через lazy import. Запис на диск робить
 * tool `edit_anchored` — він у WRITE_TOOLS write-guard, тож підлягає тому самому
 * scope/denylist veto, pre-image snapshot і rollback, що й built-in `edit`/`write`.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** Довжина якоря у base36-символах (36³ = 46656 значень — на рядок, не на файл). */
const ANCHOR_LEN = 3

/**
 * Якір рядка: перші 3 base36-символи sha256 від вмісту рядка.
 * Навмисно БЕЗ номера рядка у хеші: якір «прив'язаний до вмісту», а номер іде
 * окремим полем правки — розбіжність будь-якого з двох означає stale-стан.
 * @param {string} text вміст рядка (без завершального \n)
 * @returns {string} 3-символьний base36-якір
 */
export function lineAnchor(text) {
  const h = createHash('sha256').update(text, 'utf8').digest()
  return (h.readUInt32BE(0) % 36 ** ANCHOR_LEN).toString(36).padStart(ANCHOR_LEN, '0')
}

/**
 * Рендерить вміст файлу у anchored-форматі: `якір|номер|текст`, нумерація з 1.
 * @param {string} content повний вміст файлу
 * @param {{ from?: number, to?: number }} [range] діапазон рядків (включно, 1-based)
 * @returns {string} anchored-подання (по рядку на кожен рядок діапазону)
 */
export function renderAnchored(content, { from = 1, to = Infinity } = {}) {
  const lines = content.split('\n')
  const out = []
  for (let i = from; i <= Math.min(to, lines.length); i++) {
    const text = lines[i - 1]
    out.push(`${lineAnchor(text)}|${i}|${text}`)
  }
  return out.join('\n')
}

/**
 * Атомарно застосовує anchored-правки до вмісту файлу.
 *
 * Валідація ПЕРЕД застосуванням: кожна правка перевіряється на (а) існування рядка,
 * (б) збіг якоря з поточним вмістом. Хоч одна stale → нічого не застосовується.
 * Семантика правки: `newText` — заміна рядка (може бути багаторядковим), `null` —
 * видалення рядка. Дублікати номера рядка у списку правок — теж відмова (двозначно).
 * @param {string} content поточний вміст файлу
 * @param {Array<{ anchor: string, line: number, newText: string|null }>} edits правки
 * @returns {{ ok: true, content: string } | { ok: false, stale: Array<{ line: number, reason: string }> }}
 *   новий вміст або перелік розбіжностей (для структурованої відповіді агенту)
 */
export function applyAnchoredEdits(content, edits) {
  const lines = content.split('\n')
  const stale = []
  const seen = new Set()
  for (const e of edits) {
    if (!Number.isSafeInteger(e.line) || e.line < 1 || e.line > lines.length) {
      stale.push({ line: e.line, reason: `рядка ${e.line} не існує (у файлі ${lines.length})` })
      continue
    }
    if (seen.has(e.line)) {
      stale.push({ line: e.line, reason: `рядок ${e.line} правиться двічі в одному виклику` })
      continue
    }
    seen.add(e.line)
    const actual = lineAnchor(lines[e.line - 1])
    if (e.anchor !== actual) {
      stale.push({ line: e.line, reason: `stale anchor ${e.anchor} (актуальний ${actual}) — перечитай файл` })
    }
  }
  if (stale.length > 0) return { ok: false, stale }

  // Застосування знизу вгору — номери рядків вище не зсуваються.
  const sorted = edits.toSorted((a, b) => b.line - a.line)
  for (const e of sorted) {
    if (e.newText === null) lines.splice(e.line - 1, 1)
    else lines.splice(e.line - 1, 1, ...e.newText.split('\n'))
  }
  return { ok: true, content: lines.join('\n') }
}

/**
 * Резолвить шлях tool-виклику відносно cwd сесії.
 * @param {string} cwd робоча директорія сесії
 * @param {string} raw шлях із tool-input
 * @returns {string} абсолютний шлях
 */
function resolvePath(cwd, raw) {
  return isAbsolute(raw) ? raw : resolve(cwd, raw)
}

/**
 * Структурована текстова відмова tool-виклику (JSON-текст — слабкі моделі бачать
 * точну причину і наступний крок).
 * @param {object} payload обʼєкт з `error` (+ опційні деталі)
 * @returns {{ content: Array<{ type: string, text: string }>, details: object }} tool-результат
 */
function toolFail(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], details: {} }
}

/**
 * Фабрика пари pi-tools `read_anchored`/`edit_anchored`.
 *
 * `defineTool` передається caller-ом (lazy pi-import в agent-fix) — модуль лишається
 * pi-free. Обидва tools повертають результат текстом (JSON для помилок), щоб слабкі
 * моделі бачили точну причину відмови і мали інструкцію наступного кроку.
 * @param {{ cwd: string, defineTool: (def: object) => object,
 *   fs?: { existsSync?: typeof existsSync, readFileSync?: typeof readFileSync, writeFileSync?: typeof writeFileSync } }} args
 *   контекст: cwd сесії, pi defineTool, опційні fs-інжекції для тестів
 * @returns {{ readTool: object, editTool: object }} tool-дефініції для customTools
 */
export function createAnchoredTools({ cwd, defineTool, fs = {} }) {
  const exists = fs.existsSync ?? existsSync
  const read = fs.readFileSync ?? readFileSync
  const write = fs.writeFileSync ?? writeFileSync

  const readTool = defineTool({
    name: 'read_anchored',
    label: 'Read (anchored)',
    description:
      'Read a file as anchored lines "anchor|lineNo|text". To edit an existing file you MUST read it with this tool first and use the returned anchors in edit_anchored.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'file path' },
        from: { type: 'number', description: 'first line (1-based, optional)' },
        to: { type: 'number', description: 'last line (inclusive, optional)' }
      },
      required: ['path']
    },
    execute: (_id, { path, from, to }) => {
      const abs = resolvePath(cwd, path)
      if (!exists(abs)) return toolFail({ error: `файл не існує: ${path}` })
      const text = renderAnchored(read(abs, 'utf8'), { from: from ?? 1, to: to ?? Infinity })
      return { content: [{ type: 'text', text }], details: {} }
    }
  })

  const editTool = defineTool({
    name: 'edit_anchored',
    label: 'Edit (anchored)',
    description:
      'Strictly edit a file by anchored lines. Each edit = {anchor, line, newText}; newText replaces the whole line (may be multiline), null deletes the line. Anchors come from read_anchored. Any stale anchor rejects the WHOLE call — re-read the file and retry. No fuzzy matching.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'file path' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              anchor: { type: 'string', description: '3-char anchor from read_anchored' },
              line: { type: 'number', description: '1-based line number' },
              newText: { type: ['string', 'null'], description: 'replacement text (null = delete line)' }
            },
            required: ['anchor', 'line']
          }
        }
      },
      required: ['path', 'edits']
    },
    execute: (_id, { path, edits }) => {
      const abs = resolvePath(cwd, path)
      if (!exists(abs)) return toolFail({ error: `файл не існує: ${path} — для нового файлу використовуй write` })
      if (!Array.isArray(edits) || edits.length === 0) return toolFail({ error: 'edits порожній' })
      const normalized = edits.map(e => ({ anchor: e.anchor, line: e.line, newText: e.newText ?? null }))
      const res = applyAnchoredEdits(read(abs, 'utf8'), normalized)
      if (!res.ok) return toolFail({ error: 'stale anchors — нічого не застосовано', stale: res.stale })
      write(abs, res.content)
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, applied: normalized.length }) }],
        details: {}
      }
    }
  })

  return { readTool, editTool }
}
