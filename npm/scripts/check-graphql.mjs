/**
 * Перевіряє правило graphql.mdc: наявність **`.graphqlrc.yml`** і рекомендації
 * **`graphql.vscode-graphql`**, якщо у дереві є **`gql\`…\``**.
 *
 * Обхід репозиторію — **`walkDir`** від **`process.cwd()`** (пропуски як у інших check). Кандидати — **`.vue`** та **`.js`/`.ts`/`.jsx`/`.tsx`** тощо; пропуск **`.d.ts`**, **auto-imports.d.ts** тощо — **`shouldSkipFileForGqlScan`**.
 *
 * Виявлення **`gql`** — **oxc-parser** після витягування `<script>` з SFC (**`graphql-gql-scan.mjs`**). Якщо збігів немає — перевірка завершується успішно без вимог до конфігів.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

import { createCheckReporter } from './utils/check-reporter.mjs'
import {
  isGqlScanSourceFile,
  shouldSkipFileForGqlScan,
  sourceFileHasGqlTaggedTemplate
} from './utils/graphql-gql-scan.mjs'
import { loadCursorIgnorePaths } from './utils/load-cursor-config.mjs'
import { walkDir } from './utils/walkDir.mjs'

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
 * Перевіряє `.vscode/extensions.json` на рекомендацію GraphQL extension.
 * @param {(msg: string) => void} pass success-репортер
 * @param {(msg: string) => void} fail fail-репортер
 * @returns {Promise<void>}
 */
async function checkExtensionsRecommendation(pass, fail) {
  if (!existsSync('.vscode/extensions.json')) {
    fail(
      '.vscode/extensions.json не існує — створи файл і додай у recommendations graphql.vscode-graphql (graphql.mdc)'
    )
    return
  }

  let ext
  try {
    ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
  } catch {
    fail('.vscode/extensions.json не є валідним JSON')
    return
  }

  const rec = ext.recommendations
  if (!Array.isArray(rec)) {
    fail('.vscode/extensions.json: поле recommendations має бути масивом')
    return
  }

  if (rec.includes(REQUIRED_GRAPHQL_VSCODE_EXTENSION)) {
    pass(`.vscode/extensions.json: є ${REQUIRED_GRAPHQL_VSCODE_EXTENSION}`)
  } else {
    fail(`.vscode/extensions.json: додай у recommendations "${REQUIRED_GRAPHQL_VSCODE_EXTENSION}" (graphql.mdc)`)
  }
}

/**
 * Перевіряє graphql.mdc: умовна вимога .graphqlrc.yml і graphql.vscode-graphql
 * за наявності gql tagged templates.
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const root = process.cwd()
  const ignorePaths = await loadCursorIgnorePaths(root)
  const candidates = await collectScanCandidates(root, ignorePaths)
  const hits = await collectGqlHits(root, candidates)

  if (hits.length === 0) {
    pass(
      `Немає tagged template з тегом gql у .vue / JS / TS джерелах (переглянуто ${candidates.length} файлів) — .graphqlrc.yml не вимагається`
    )
    return reporter.getExitCode()
  }

  pass(`Знайдено gql\`…\` у ${hits.length} файлі(ах): ${hits.slice(0, 5).join(', ')}${hits.length > 5 ? '…' : ''}`)

  if (existsSync(GRAPHQL_RC_FILENAME)) {
    pass(`${GRAPHQL_RC_FILENAME} існує`)
  } else {
    fail(
      `Відсутній ${GRAPHQL_RC_FILENAME} у корені — додай GraphQL Config (graphql.mdc), бо в проєкті є gql template literals`
    )
  }

  await checkExtensionsRecommendation(pass, fail)

  return reporter.getExitCode()
}
