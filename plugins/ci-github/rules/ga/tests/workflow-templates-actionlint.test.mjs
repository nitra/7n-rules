/**
 * Гейт проти класу вад «канонічний GH Actions workflow, який генерує сам пакет
 * (`template/*.yml.snippet.yml`), не проходить власний `ga/workflows`-лінт»
 * (rust/workspace_root PR #179: `$GITHUB_PATH` без лапок у lint-k8s.yml.snippet.yml
 * ловив deadlock — фікс на боці споживача неможливий, бо policy читає той самий
 * template drift-safe). Збирає всі `template/*.yml.snippet.yml` у репо, лишає ті,
 * що реально є GH Actions workflow (мають `on`+`jobs` — відсікає ci-azure snippet'и
 * у тому самому naming-патерні), і жене їх одним батчем через `actionlint`
 * (shellcheck SC-правила теж, якщо `shellcheck` є в PATH — як у CI).
 *
 * Дві категорії винятків з гейту:
 * - `EXCLUDED_DOC_TEMPLATES` — шаблони, що НЕ є машинним каноном (нема
 *   fix-*.mjs, який їх читає й підставляє), а документаційним прикладом з
 *   плейсхолдером для людини (напр. `deploy-service.yml.snippet.yml`: коментар
 *   у файлі прямо каже «Плейсхолдер run/<service> заміни на каталог сервісу»).
 *   Лінтити їх як-є — false positive за конструкцією.
 * - Рядки-токени `__ДОВІЛЬНИЙ_ТОКЕН__` (весь рядок — один токен) — машинний
 *   плейсхолдер, який підставляє fix-скрипт (напр. `__STORYBOOK_CI_PACKAGE_DIRS__`
 *   → матриця пакетів) ПЕРЕД записом реального workflow. Синтаксично невалідні
 *   до підстановки за конструкцією — підставляємо мінімальний валідний
 *   YAML-sequence-item тієї ж структури (без знання конкретної семантики
 *   плейсхолдера), щоб перевіряти реальний синтаксис навколо, а не сам токен.
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { parseWorkflowYaml } from '@7n/rules/scripts/lib/gha-workflow.mjs'
import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Шаблони, що НЕ є машинним каноном — документаційні приклади з human-плейсхолдерами. */
const EXCLUDED_DOC_TEMPLATES = ['ga/service_deploy_workflow/template/deploy-service.yml.snippet.yml']

const TOKEN_LINE_RE = /^([ \t]*)__[A-Z0-9_]+__[ \t]*$/mu

/**
 * Корінь репозиторію (git toplevel від цього тестового файлу).
 * @returns {string} абсолютний шлях
 */
function repoRoot() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' })
  return r.stdout.trim()
}

/**
 * Чи є файл GH Actions workflow-шаблоном (на відміну від, напр., ci-azure
 * `*.yml.snippet.yml` того самого naming-патерну, у якого нема `on`/`jobs`).
 * @param {string} content вміст файлу
 * @returns {boolean} true — валідний YAML з `on` і `jobs` на корені
 */
function looksLikeGhaWorkflow(content) {
  const parsed = parseWorkflowYaml(content)
  return Boolean(parsed && parsed.jobs && ('on' in parsed || 'true' in parsed))
}

/**
 * Підставляє мінімальний валідний YAML-sequence-item замість рядків-токенів
 * `__TOKEN__`, зберігаючи відступ — актуальна семантика підстановки (список
 * пакетів, шляхів тощо) байдужа для синтаксичної перевірки actionlint/shellcheck.
 * @param {string} content вихідний вміст template
 * @returns {string} вміст з підставленими токенами
 */
function substitutePlaceholderTokens(content) {
  return content.replace(TOKEN_LINE_RE, (_match, indent) => `${indent}- placeholder-item`)
}

describe('canon GH Actions workflow templates проходять власний actionlint', () => {
  test('усі template/*.yml.snippet.yml без SC/actionlint порушень', async () => {
    const root = repoRoot()
    /** @type {string[]} */
    const candidates = []
    await walkDir(root, absPath => {
      if (absPath.endsWith('.yml.snippet.yml') && absPath.includes(`${'template'}/`)) {
        candidates.push(absPath)
      }
    })
    expect(candidates.length).toBeGreaterThan(0)

    const ghaFiles = []
    for (const absPath of candidates) {
      const relPath = relative(root, absPath)
      if (EXCLUDED_DOC_TEMPLATES.some(excluded => relPath.endsWith(excluded))) continue
      const content = await readFile(absPath, 'utf8')
      if (looksLikeGhaWorkflow(content)) ghaFiles.push({ absPath, relPath, content })
    }
    expect(ghaFiles.length).toBeGreaterThan(0)

    if (!resolveCmd('bunx')) {
      // Немає bunx локально (мінімальне CI-середовище без bun) — actionlint недоступний, skip.
      return
    }

    const tmpDir = await mkdtemp(join(tmpdir(), 'n-rules-workflow-templates-actionlint-'))
    try {
      const tmpFiles = []
      for (const { relPath, content } of ghaFiles) {
        const tmpPath = join(tmpDir, relPath.replaceAll('/', '__'))
        await writeFile(tmpPath, substitutePlaceholderTokens(content), 'utf8')
        tmpFiles.push({ tmpPath, relPath })
      }

      const result = spawnSync('bunx', ['github-actionlint', ...tmpFiles.map(f => f.tmpPath)], {
        cwd: root,
        encoding: 'utf8'
      })
      // Мапимо tmp-шляхи назад у relPath репо для читабельного репорту.
      let report = `${result.stdout}\n${result.stderr}`
      for (const { tmpPath, relPath } of tmpFiles) report = report.replaceAll(tmpPath, relPath)

      expect(result.status, `actionlint порушення:\n${report}`).toBe(0)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
