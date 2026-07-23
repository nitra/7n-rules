/**
 * Опційні fix-hooks Python-провайдера (LLM-шлях концерну coverage): агентні
 * fix-сесії `runAgentFix` (`@7n/llm-lib/agent-fix`) пишуть pytest-тести для
 * файлів нижче порогу покриття (`generateTests`) і тести, що вбивають
 * survived-мутанти mutmut (`fixSurvived`). Ladder-контракт той самий, що в
 * JS/Rust-хуків: `ctx.recordWrite` через write-guard агента, `ctx.timeoutMs`
 * прокидається сесії, власних retry-циклів немає — конвергенцію жене ladder
 * ядра. `@7n/llm-lib` — dependency ядра `@7n/rules`, не плагіна: динамічні
 * import-и (канонічний патерн fix-worker-ів).
 */
const { runAgentFix } = await import('@7n/llm-lib/agent-fix')
const { CLOUD_MAX } = await import('@7n/llm-lib/model-tiers')

/**
 * Промпт догенерації pytest-тестів для файлів нижче порогу покриття.
 * @param {Array<{file: string, pct: number}>} files файли з делта-гейта
 * @returns {string} промпт агентної сесії
 */
export function buildGenTestsPrompt(files) {
  return [
    '# Догенерація pytest-тестів (гейт покриття)',
    '',
    'Файли нижче порогу line coverage — допиши unit-тести, що покривають їхню реальну поведінку:',
    '',
    ...files.map(f => `- \`${f.file}\` (зараз ${f.pct.toFixed(1)}%)`),
    '',
    '## Вимоги',
    '- Тести — pytest у теці `tests/` поряд із пакетом (`test_<модуль>.py`), запуск через `uv run pytest`.',
    '- Перевіряй поведінку публічних функцій, включно з гілками помилок; без тестів заради тестів.',
    '- Після правок запусти `uv run pytest` і переконайся, що все зелене.',
    '- Не змінюй production-код — лише додавай тести.'
  ].join('\n')
}

/**
 * Промпт написання тестів, що вбивають survived-мутанти mutmut.
 * @param {Array<{file: string, mutants: Array<{line: number, original: string, replacement: string}>}>} survived групи по файлах
 * @returns {string} промпт агентної сесії
 */
export function buildFixSurvivedPrompt(survived) {
  const lines = [
    '# Вбити survived-мутанти (mutmut)',
    '',
    'Мутації нижче пережили тест-suite — допиши pytest-тести, які їх ловлять (падають на мутованому коді, зелені на оригіналі):',
    ''
  ]
  for (const group of survived) {
    lines.push(`## \`${group.file}\``)
    for (const m of group.mutants) {
      lines.push(`- рядок ${m.line}: \`${m.original}\` → \`${m.replacement}\``)
    }
    lines.push('')
  }
  lines.push(
    '## Вимоги',
    '- Асерти мають розрізняти оригінал і мутанта; тести — у `tests/` (pytest).',
    '- Після правок запусти `uv run pytest` — усе зелене.',
    '- Не змінюй production-код — лише додавай тести.'
  )
  return lines.join('\n')
}

/**
 * Спільний запуск агентної fix-сесії з ladder ctx-полями.
 * @param {string} prompt промпт сесії
 * @param {string} cwd корінь проєкту
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').FixContext} ctx FixContext ladder-а
 * @param {string[]} targetFiles файли-цілі
 * @returns {Promise<{touchedFiles: string[]}>} фактично змінені файли
 */
async function runSession(prompt, cwd, ctx, targetFiles) {
  const res = await runAgentFix('test', prompt, cwd, {
    model: ctx?.model ?? CLOUD_MAX,
    tier: ctx?.tier,
    timeoutMs: ctx?.timeoutMs,
    feedback: ctx?.feedback ?? null,
    caller: `fix:test/coverage:python:${ctx?.tier ?? 'gen'}`,
    recordWrite: ctx?.recordWrite,
    chain: ctx?.chain ?? null,
    targetFiles
  })
  if (res.error) {
    console.error(`✗ python coverage fix: сесія не завершилась — ${res.error}`)
  }
  return { touchedFiles: res.touchedFiles ?? [] }
}

/**
 * Догенерація pytest-тестів для файлів нижче порогу (hook `generateTests`).
 * @param {{cwd: string, files: Array<{file: string, pct: number}>, ctx: object}} args корінь, файли, FixContext
 * @returns {Promise<{touchedFiles: string[]}>} записані файли
 */
export function generatePythonTests({ cwd, files, ctx }) {
  const pyFiles = (files ?? []).filter(f => f.file.endsWith('.py'))
  if (pyFiles.length === 0) return Promise.resolve({ touchedFiles: [] })
  return runSession(
    buildGenTestsPrompt(pyFiles),
    cwd,
    ctx,
    pyFiles.map(f => f.file)
  )
}

/**
 * Тести проти survived-мутантів mutmut (hook `fixSurvived`).
 * @param {{cwd: string, survived: Array<object>, ctx: object}} args корінь, survived-групи, FixContext
 * @returns {Promise<{touchedFiles: string[]}>} записані файли
 */
export function fixPythonSurvived({ cwd, survived, ctx }) {
  const pyGroups = (survived ?? []).filter(g => g.file?.endsWith('.py'))
  if (pyGroups.length === 0) return Promise.resolve({ touchedFiles: [] })
  return runSession(
    buildFixSurvivedPrompt(pyGroups),
    cwd,
    ctx,
    pyGroups.map(g => g.file)
  )
}
