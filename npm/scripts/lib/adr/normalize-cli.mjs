/**
 * CLI-обгортка локального ADR-нормалізатора (`n-cursor adr-normalize-local`).
 *
 * Прод-шлях `.claude/hooks/normalize-decisions.sh` викликає цю команду як
 * local-backend замість single-shot LLM-виклику: bash готує батч і clean-список,
 * CLI проганяє `normalizePipeline` і друкує у stdout той самий контракт
 * `{ "operations": [...] }`, що його далі парсить і застосовує bash. Прогрес —
 * у stderr (потрапляє в normalize-decisions.log).
 *
 * Аргументи:
 *   --batch <file>    newline-список абсолютних шляхів до чернеток батчу
 *   --clean <file>    newline-список basename-ів clean-ADR (merge-into кандидати)
 *   --adr-dir <dir>   тека docs/adr (для резолву basename ↔ шлях; default cwd/docs/adr)
 *
 * ENV:
 *   ADR_NORMALIZE_ALLOW_CLOUD=1  дозволити хмарну ескалацію tier-каскаду (default off)
 *   ADR_NORMALIZE_VOTES=N        голосів self-consistency для clean-ребер (default 2)
 */
import { env } from 'node:process'
import { readFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { normalizePipeline } from './normalize-pipeline.mjs'

/**
 * Парсить `--key value` пари у плоский об'єкт.
 * @param {string[]} argv масив аргументів командного рядка
 * @returns {Record<string, string>} мапа ключ→значення з `--key value` пар
 */
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++ }
  }
  return out
}

const readLines = (file) =>
  readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)

/**
 * Точка входу субкоманди. Друкує `{operations}` JSON у stdout, прогрес — у stderr.
 * @param {string[]} argv аргументи після назви команди
 * @returns {number} exit-code (0 — успіх, 1 — помилка вводу)
 */
export function runAdrNormalizeLocalCli(argv) {
  const args = parseArgs(argv)
  const adrDir = args['adr-dir'] ?? join(process.cwd(), 'docs/adr')
  if (!args.batch) {
    console.error('Usage: n-cursor adr-normalize-local --batch <file> [--clean <file>] [--adr-dir <dir>]')
    return 1
  }

  const batchPaths = readLines(args.batch)
  const drafts = batchPaths.map((p) => {
    const abs = isAbsolute(p) ? p : join(adrDir, p)
    return { file: basename(abs), body: readFileSync(abs, 'utf8') }
  })
  const cleanList = args.clean ? readLines(args.clean).map((c) => basename(c)) : []

  const allowCloud = env.ADR_NORMALIZE_ALLOW_CLOUD === '1'
  const votes = Number(env.ADR_NORMALIZE_VOTES) || 2

  const { operations, stats, trace } = normalizePipeline(drafts, cleanList, {
    allowCloud,
    votes,
    onProgress: (m) => console.error(`adr-normalize-local: ${m}`)
  })

  console.error(`adr-normalize-local: ${operations.length} операцій, stats=${JSON.stringify(stats)}`)
  console.error(`adr-normalize-local: decisions=${JSON.stringify(trace.decisions)}`)
  process.stdout.write(JSON.stringify({ operations }))
  return 0
}
