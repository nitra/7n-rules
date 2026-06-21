import { spawnSync } from 'node:child_process'

import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'
import { createCheckReporter } from '../../scripts/lib/check-reporter.mjs'

const JSON_MAX_BUFFER = 20 * 1024 * 1024

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня (applies → JS-concerns
 * → policy → mdc-refs); `lint()` — lint-поверхня (`@nitra/minify-image`), імпл інлайн тут.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

/**
 * Парсить JSON-звіт `@nitra/minify-image --json`.
 * @param {string} stdout stdout дочірнього процесу
 * @returns {{ summary?: { needsCompression?: unknown, total?: unknown } }} розпарсений звіт
 */
function parseMinifyJson(stdout) {
  return JSON.parse(stdout)
}

/**
 * Read-only detect-mode: `@nitra/minify-image --json` не стискає файли і не пише cache, але
 * повідомляє скільки зображень не відповідають `.n-minify-image.tsv`.
 * @param {string} cwd корінь
 * @returns {number} exit code
 */
function runJsonDetect(cwd) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const r = spawnSync('npx', ['@nitra/minify-image', '--src=.', '--json'], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: JSON_MAX_BUFFER
  })
  if (r.error) {
    fail(`image-compress: не вдалося запустити npx @nitra/minify-image --json: ${r.error.message}`)
    return reporter.getExitCode()
  }
  if (r.status !== 0) {
    const detail = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
    fail(`image-compress: @nitra/minify-image --json завершився з кодом ${r.status}${detail ? `:\n${detail}` : ''}`)
    return reporter.getExitCode()
  }

  let report
  try {
    report = parseMinifyJson(r.stdout)
  } catch {
    fail('image-compress: @nitra/minify-image --json повернув невалідний JSON')
    return reporter.getExitCode()
  }

  const needsCompression = Number(report.summary?.needsCompression ?? 0)
  const total = Number(report.summary?.total ?? 0)
  if (needsCompression > 0) {
    fail(
      `image-compress: ${needsCompression}/${total} image-файлів потребують стиснення — запусти \`n-cursor lint image-compress\` локально`
    )
  } else {
    pass(`image-compress: ${total} image-файлів синхронізовані з .n-minify-image.tsv`)
  }
  return reporter.getExitCode()
}

/**
 * lint-поверхня: `@nitra/minify-image` (readOnly → `--json` детект; fix → `--write`).
 * @param {string[] | undefined} _files ігнорується; `@nitra/minify-image` сам обходить дерево
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean }} [opts] readOnly → `--json`, fix → `--write`
 * @returns {Promise<number>} exit code
 */
export function lint(_files, cwd = process.cwd(), opts = {}) {
  if (opts.readOnly === true) return Promise.resolve(runJsonDetect(cwd))
  const r = spawnSync('npx', ['@nitra/minify-image', '--src=.', '--write'], { cwd, env: process.env, stdio: 'inherit' })
  if (r.error) {
    console.error(`image-compress: не вдалося запустити npx @nitra/minify-image --write: ${r.error.message}`)
    return Promise.resolve(1)
  }
  return Promise.resolve(typeof r.status === 'number' ? r.status : 1)
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/<id>/main.mjs — повний еквівалент `npx @nitra/cursor check <id>`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
