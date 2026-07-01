/** @see ./docs/tooling.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import {
  isGqlScanSourceFile,
  shouldSkipFileForGqlScan,
  sourceFileHasGqlTaggedTemplate
} from '../lib/graphql-gql-scan.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { runConftestBatch } from '../../../scripts/lib/run-conftest-batch.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/** Очікуваний файл GraphQL Config у корені (graphql.mdc). */
export const GRAPHQL_RC_FILENAME = '.graphqlrc.yml'

/** Розширення VS Code з graphql.mdc. */
export const REQUIRED_GRAPHQL_VSCODE_EXTENSION = 'graphql.vscode-graphql'

/**
 * Збирає абсолютні шляхи source-файлів, які підлягають скануванню на gql templates.
 * @param {string} root абсолютний шлях кореня
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} список кандидатів
 */
async function collectScanCandidates(root, ignorePaths) {
  /** @type {string[]} */
  const candidates = []
  await walkDir(
    root,
    absPath => {
      const rel = relative(root, absPath).split('\\').join('/')
      if (shouldSkipFileForGqlScan(rel) || !isGqlScanSourceFile(rel)) {
        return
      }
      candidates.push(absPath)
    },
    ignorePaths
  )
  return candidates
}

/**
 * Повертає відносні шляхи файлів, де знайдено gql tagged template.
 * @param {string} root абсолютний шлях кореня
 * @param {string[]} candidates абсолютні шляхи файлів-кандидатів
 * @returns {Promise<string[]>} відносні шляхи файлів зі збігами
 */
async function collectGqlHits(root, candidates) {
  /** @type {string[]} */
  const hits = []
  for (const absPath of candidates) {
    const rel = relative(root, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    if (sourceFileHasGqlTaggedTemplate(content, rel)) {
      hits.push(rel)
    }
  }
  return hits
}

/**
 * Делегує валідацію `.vscode/extensions.json` rego-пакету `graphql.vscode_extensions`
 * через `runConftestBatch`. Викликається лише після того, як JS виявив `gql` у дереві
 * (умовне правило — без gql цей крок не запускається).
 * @param {(msg: string) => void} pass success-репортер
 * @param {(msg: string) => void} fail fail-репортер
 * @returns {void}
 * @param {string} cwd корінь репозиторію
 */
function checkExtensionsRecommendation(pass, fail, cwd) {
  const pathRel = '.vscode/extensions.json'
  const pathAbs = join(cwd, pathRel)
  if (!existsSync(pathAbs)) {
    fail(
      `${pathRel} не існує — створи файл і додай у recommendations ${REQUIRED_GRAPHQL_VSCODE_EXTENSION} (graphql.mdc)`
    )
    return
  }
  const violations = runConftestBatch({
    policyDirRel: 'graphql/vscode_extensions',
    namespace: 'graphql.vscode_extensions',
    files: [pathAbs]
  })
  if (violations.length === 0) {
    pass(`${pathRel} відповідає graphql.vscode_extensions (rego)`)
    return
  }
  for (const v of violations) fail(v.message)
}

/**
 * Перевіряє graphql.mdc: умовна вимога .graphqlrc.yml і graphql.vscode-graphql
 * за наявності gql tagged templates.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону (cwd тощо)
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат зі зібраними violations
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const root = ctx.cwd
  const ignorePaths = await loadCursorIgnorePaths(root)
  const candidates = await collectScanCandidates(root, ignorePaths)
  const hits = await collectGqlHits(root, candidates)

  if (hits.length === 0) {
    pass(
      `Немає tagged template з тегом gql у .vue / JS / TS джерелах (переглянуто ${candidates.length} файлів) — .graphqlrc.yml не вимагається`
    )
    return reporter.result()
  }

  pass(`Знайдено gql\`…\` у ${hits.length} файлі(ах): ${hits.slice(0, 5).join(', ')}${hits.length > 5 ? '…' : ''}`)

  if (existsSync(join(root, GRAPHQL_RC_FILENAME))) {
    pass(`${GRAPHQL_RC_FILENAME} існує`)
  } else {
    fail(
      `Відсутній ${GRAPHQL_RC_FILENAME} у корені — додай GraphQL Config (graphql.mdc), бо в проєкті є gql template literals`
    )
  }

  checkExtensionsRecommendation(pass, fail, root)

  return reporter.result()
}
