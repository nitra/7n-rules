/**
 * docgen-конвеєр (входна точка): код файлу → .md-документація.
 *
 * Інверсія керування: веде цей JS, а локальна модель — лише сервіс перефразування.
 *   Stage 0  extractFacts        — факти з коду (0 токенів)
 *   Stage 1  sectionInstructions — точкові промпти на кожну секцію (спільний KV-cached префікс)
 *   Stage 3  assemble            — фіксовані заголовки/порядок + зрізання fence
 * Режим `--oneshot` — база для порівняння (один промпт на весь документ).
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { request } from 'node:http'
import { extractFacts } from './docgen-extract.mjs'
import { sectionMessages, oneShotMessages } from './docgen-prompts.mjs'

/** Один виклик чату до ollama зі streaming (токени стримуються → socket активний, жодного timeout). */
async function ollamaChat(messages, { model, numPredict = 600 }) {
  const body = JSON.stringify({
    model, messages, stream: true, think: false,
    options: { num_ctx: 8192, temperature: 0.2, num_predict: numPredict },
    keep_alive: '15m'
  })
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: 'localhost', port: 11434, path: '/api/chat', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let text = '', genTok = 0, buf = ''
        res.on('data', chunk => {
          buf += chunk.toString()
          const lines = buf.split('\n')
          buf = lines.pop()
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const j = JSON.parse(line)
              text += j.message?.content ?? ''
              if (j.done) genTok = j.eval_count ?? 0
            } catch { /* partial line */ }
          }
        })
        res.on('end', () => resolve({ text, genTok }))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/** Прибирає ```-обгортку й випадковий провідний `##`-заголовок із секції. */
function stripSection(text) {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-z]*\n?/, '').replace(/\n?```\s*$/, '').trim()
  }
  t = t.replace(/^#{1,6}\s+.*\n+/, '') // зрізати випадковий заголовок
  return t.trim()
}

/**
 * Stage 2 (детермінований лінт, 0 токенів): зрізає сигнатури `name(args)` → `name`.
 * Два проходи — щоб зняти вкладені виклики на кшталт `check(cwd = process.cwd())`.
 * Не чіпає дужки без ідентифікатора перед ними (напр. `(abie.mdc)`, «(наприклад)»).
 */
function stripSignatures(text) {
  let t = text
  for (let i = 0; i < 2; i++) t = t.replace(/([`\w$.]+)\([^()]*\)/g, '$1')
  return t
}

/** Stage 3: фіксовані заголовки у фіксованому порядку. */
function assemble(stem, sections) {
  const order = [
    ['overview', '## Огляд'],
    ['behavior', '## Поведінка'],
    ['api', '## Публічний API'],
    ['guarantees', '## Гарантії поведінки']
  ]
  const parts = [`# ${stem}`]
  for (const [key, title] of order) {
    const body = sections[key]
    if (body && body.trim()) parts.push(`${title}\n\n${body.trim()}`)
  }
  return parts.join('\n\n') + '\n'
}

/** Оркестрований режим: секційно-мінімальний контекст — код інгестується лише в `behavior`. */
async function generateOrchestrated(facts, src, model) {
  const sections = {}
  let genTok = 0
  for (const s of sectionMessages(facts, src)) {
    const { text, genTok: g } = await ollamaChat(s.messages, { model, numPredict: s.numPredict })
    sections[s.key] = stripSignatures(stripSection(text))
    genTok += g
  }
  return { md: assemble(basename(facts.relPath), sections), genTok }
}

/** One-shot режим: один промпт на весь документ. */
async function generateOneShot(facts, src, model) {
  const { text, genTok } = await ollamaChat(oneShotMessages(facts, src), { model, numPredict: 1500 })
  let md = stripSignatures(stripSection(text)) // Stage-2 лінт і для one-shot
  if (!md.startsWith('#')) md = `# ${basename(facts.relPath)}\n\n${md}`
  return { md: md + '\n', genTok }
}

/** Головний API: файл → { md, genTok, ms }. */
export async function generateDoc(file, { model = 'gemma3:4b', mode = 'orchestrated' } = {}) {
  const src = readFileSync(file, 'utf8')
  const facts = extractFacts(src, file)
  const t0 = Date.now()
  const r = facts.unsupported
    ? await generateOneShot(facts, src, model) // fallback для не-JS
    : mode === 'oneshot'
      ? await generateOneShot(facts, src, model)
      : await generateOrchestrated(facts, src, model)
  return { ...r, ms: Date.now() - t0 }
}

// CLI: node docgen-gen.mjs <file> [--oneshot] [--model <m>]
import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
if (isRunAsCli(import.meta.url)) {
  const args = process.argv.slice(2)
  const file = args.find(a => !a.startsWith('--'))
  const mode = args.includes('--oneshot') ? 'oneshot' : 'orchestrated'
  const mi = args.indexOf('--model'); const model = mi >= 0 ? args[mi + 1] : 'gemma3:4b'
  if (!file) { console.error('Usage: node docgen-gen.mjs <file> [--oneshot] [--model <m>]'); process.exit(1) }
  const r = await generateDoc(file, { model, mode })
  process.stderr.write(`[${mode}] ${r.ms}ms / ${r.genTok} tok\n`)
  process.stdout.write(r.md)
}
