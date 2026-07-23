/**
 * Промпт-builder для coverage-classify.
 * SYSTEM_PROMPT — статичний, кешується через cache_control: ephemeral у API call.
 * buildUserPrompt — асемблює per-mutant контекст (location, source ±10, tests, git).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const CONTEXT_LINES = 10
const TEST_FILE_MAX_LINES = 2000

/** Системний промпт класифікатора survived-мутантів (5 verdict-категорій). */
export const SYSTEM_PROMPT = `You are a mutation testing classifier.

For each survived Stryker mutant, classify it into exactly one verdict:

- **worth-testing**: pure logic with real branches that should be tested. The mutant
  exposes a missing assertion in a unit test. Recommend a test approach.
- **equivalent**: the mutated code is behaviorally indistinguishable from the original
  (e.g., both branches produce the same observable output, or the mutant lies on dead
  code). You MUST cite a concrete reason referencing input flow or output equivalence.
- **defensive**: the branch guards against an impossible state given input contracts
  or type system. You MUST identify the invariant that makes the state unreachable.
- **glue**: thin CLI entrypoint, factory, or boilerplate (e.g., runStandardRule
  wrapper, fix.mjs stubs). Integration tests via subprocess cover the behavior.
  Name the integration test or pattern.
- **wrapper**: thin shell around an external tool (spawnSync, fetch, dynamic import).
  The wrapper has no logic worth unit-testing in isolation; behavior comes from the
  wrapped tool. Name the integration test or pattern.

Output ONLY a single JSON object matching this schema — no markdown code fences, no
prose before or after, nothing but the JSON object itself:

\`\`\`
{
  "verdict": "worth-testing" | "equivalent" | "defensive" | "glue" | "wrapper",
  "confidence": number 0-1,
  "reason": string (20-500 chars; concrete code-level reference, not "seems like"),
  "suggestedTest": string (max 300 chars; required only when verdict is worth-testing)
}
\`\`\`

The response must be valid JSON, parseable by a strict JSON.parse. In particular:
- "reason" and "suggestedTest" are single-line strings: no literal newlines — if you
  need to separate points, use "; " instead of a line break.
- Escape every double quote and backslash that occurs inside a string value (e.g. a
  quoted identifier like \`user.role\`, or a regex like /\\d+/, must become
  \\"user.role\\" and /\\\\d+/ inside the JSON string).
- Stay within the 500/300 char limits above — summarize instead of running long;
  a response that gets cut off for length is worse than a terse one.

Confidence guidance:
- 0.9+: cite specific code fragment, identifier, or input contract proving the verdict.
- 0.7-0.9: strong inference from visible code structure.
- <0.7: ambiguity, lacking context, or unfamiliar pattern. Be honest.

Never invent integration test names. If you cannot identify a covering test, use
worth-testing with low confidence instead of glue/wrapper.
`

/**
 * Витягує describe/test/it title з рядка тексту.
 * @param {string} content повний текст test-файла
 * @returns {string} список "describe: <title>" / "test: <title>" або порожній
 */
function extractTestTitles(content) {
  const titles = []
  for (const match of content.matchAll(/^[ \t]{0,16}(describe|test|it)\(['"`](.{1,300}?)['"`]/gmu)) {
    titles.push(`${match[1]}: ${match[2]}`)
  }
  return titles.join('\n') || '(no describe/test blocks found)'
}

/**
 * Будує користувацький промпт для класифікації одного мутанта.
 * @param {{file: string, line: number, col: number, mutantType: string, original: string, replacement: string}} mutant параметри мутанта (file — відносний до cwd)
 * @param {string} cwd корінь проєкту
 * @returns {string} user prompt
 */
export function buildUserPrompt(mutant, cwd) {
  const absPath = join(cwd, mutant.file)

  // Source context
  let srcContext = '(source file unavailable)'
  if (existsSync(absPath)) {
    const lines = readFileSync(absPath, 'utf8').split('\n')
    const start = Math.max(0, mutant.line - 1 - CONTEXT_LINES)
    const end = Math.min(lines.length, mutant.line + CONTEXT_LINES)
    srcContext = lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}: ${l}`)
      .join('\n')
  }

  // Existing tests
  const testPath = join(dirname(absPath), 'tests', `${basename(absPath, '.mjs')}.test.mjs`)
  let existingTests = '(no test file)'
  if (existsSync(testPath)) {
    const content = readFileSync(testPath, 'utf8')
    if (content.split('\n').length > TEST_FILE_MAX_LINES) {
      existingTests = extractTestTitles(content)
    } else {
      existingTests = content
    }
  }

  // Recent git activity (graceful если нет git або untracked)
  let recentActivity = '(no git history)'
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ar', '--', absPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (out) recentActivity = out
  } catch {
    // git unavailable or file untracked — keep placeholder
  }

  return `# Mutant
File: ${mutant.file}
Line: ${mutant.line}:${mutant.col}
Type: ${mutant.mutantType}
Original code: \`${mutant.original}\`
Mutated to: \`${mutant.replacement}\`

# Source context (±${CONTEXT_LINES} lines)
${srcContext}

# Existing tests
${existingTests}

# Recent activity
File last modified: ${recentActivity}
`
}
