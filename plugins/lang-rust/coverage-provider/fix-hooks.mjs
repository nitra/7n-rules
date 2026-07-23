/**
 * Опційні fix-hooks Rust-провайдера (LLM-шлях концерну coverage): агентні
 * fix-сесії `runAgentFix` (`@7n/llm-lib/agent-fix`) пишуть `#[cfg(test)]`-тести
 * для файлів нижче порогу покриття (`generateTests`) і тести, що вбивають
 * survived-мутанти cargo-mutants (`fixSurvived`). Ladder-контракт той самий,
 * що в JS-хуків: `ctx.recordWrite` через write-guard агента, `ctx.timeoutMs`
 * прокидається сесії, власних retry-циклів немає — конвергенцію жене ladder
 * ядра повторними rung-ами. `@7n/llm-lib` — dependency ядра `@7n/rules`, не
 * плагіна: динамічні import-и (канонічний патерн fix-worker-ів).
 */
const { runAgentFix } = await import('@7n/llm-lib/agent-fix')
const { CLOUD_MAX } = await import('@7n/llm-lib/model-tiers')

/**
 * Промпт догенерації unit-тестів для Rust-файлів нижче порогу покриття.
 * @param {Array<{file: string, pct: number}>} files файли з делта-гейта
 * @returns {string} промпт агентної сесії
 */
export function buildGenTestsPrompt(files) {
  return [
    '# Догенерація Rust unit-тестів (гейт покриття)',
    '',
    'Файли нижче порогу line coverage — допиши unit-тести, що покривають їхню реальну поведінку:',
    '',
    ...files.map(f => `- \`${f.file}\` (зараз ${f.pct.toFixed(1)}%)`),
    '',
    '## Вимоги',
    '- Тести — у модулі `#[cfg(test)] mod tests` того самого файлу (канон Rust).',
    '- Перевіряй поведінку публічних функцій, включно з гілками помилок; без тестів заради тестів.',
    '- Після правок запусти `cargo test` і переконайся, що все зелене.',
    '- Не змінюй production-код — лише додавай тести.'
  ].join('\n')
}

/**
 * Промпт написання тестів, що вбивають survived-мутанти cargo-mutants.
 * @param {Array<{file: string, mutants: Array<{line: number, mutantType: string, original: string, replacement: string}>}>} survived групи по файлах
 * @returns {string} промпт агентної сесії
 */
export function buildFixSurvivedPrompt(survived) {
  const lines = [
    '# Вбити survived-мутанти (cargo-mutants)',
    '',
    'Мутації нижче пережили тест-suite — допиши тести, які їх ловлять (падають на мутованому коді, зелені на оригіналі):',
    ''
  ]
  for (const group of survived) {
    lines.push(`## \`${group.file}\``)
    for (const m of group.mutants) {
      lines.push(`- рядок ${m.line}: ${m.mutantType} — \`${m.original}\` → \`${m.replacement}\``)
    }
    lines.push('')
  }
  lines.push(
    '## Вимоги',
    '- Тести у `#[cfg(test)] mod tests` відповідного файлу; асерти мають розрізняти оригінал і мутанта.',
    '- Після правок запусти `cargo test` — усе зелене.',
    '- Не змінюй production-код — лише додавай тести.'
  )
  return lines.join('\n')
}

/**
 * Спільний запуск агентної fix-сесії з ladder ctx-полями.
 * @param {string} prompt промпт сесії
 * @param {string} cwd корінь проєкту
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} ctx FixContext ladder-а
 * @param {string[]} targetFiles файли-цілі (для write-guard звіту)
 * @returns {Promise<{touchedFiles: string[]}>} фактично змінені файли
 */
async function runSession(prompt, cwd, ctx, targetFiles) {
  const res = await runAgentFix('test', prompt, cwd, {
    model: ctx?.model ?? CLOUD_MAX,
    tier: ctx?.tier,
    timeoutMs: ctx?.timeoutMs,
    feedback: ctx?.feedback ?? null,
    caller: `fix:test/coverage:rust:${ctx?.tier ?? 'gen'}`,
    recordWrite: ctx?.recordWrite,
    chain: ctx?.chain ?? null,
    targetFiles
  })
  if (res.error) {
    console.error(`✗ rust coverage fix: сесія не завершилась — ${res.error}`)
    return { touchedFiles: res.touchedFiles ?? [] }
  }
  return { touchedFiles: res.touchedFiles ?? [] }
}

/**
 * Догенерація Rust-тестів для файлів нижче порогу (hook `generateTests`).
 * @param {{cwd: string, files: Array<{file: string, pct: number}>, ctx: object}} args корінь, файли, FixContext
 * @returns {Promise<{touchedFiles: string[]}>} записані файли
 */
export function generateRustTests({ cwd, files, ctx }) {
  const rustFiles = (files ?? []).filter(f => f.file.endsWith('.rs'))
  if (rustFiles.length === 0) return Promise.resolve({ touchedFiles: [] })
  return runSession(
    buildGenTestsPrompt(rustFiles),
    cwd,
    ctx,
    rustFiles.map(f => f.file)
  )
}

/**
 * Тести проти survived-мутантів cargo-mutants (hook `fixSurvived`).
 * @param {{cwd: string, survived: Array<object>, ctx: object}} args корінь, survived-групи, FixContext
 * @returns {Promise<{touchedFiles: string[]}>} записані файли
 */
export function fixRustSurvived({ cwd, survived, ctx }) {
  const rustGroups = (survived ?? []).filter(g => g.file?.endsWith('.rs'))
  if (rustGroups.length === 0) return Promise.resolve({ touchedFiles: [] })
  return runSession(
    buildFixSurvivedPrompt(rustGroups),
    cwd,
    ctx,
    rustGroups.map(g => g.file)
  )
}
