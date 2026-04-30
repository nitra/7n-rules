/**
 * Формує markdown-рядки для секції «Команди» у AGENTS.md.
 *
 * Джерело істини — `package.json` у корені цільового репозиторію: з поля `scripts` беруться відомі ключі
 * у стабільному порядку, додатково — усі `lint-*`, яких не було в основному списку.
 *
 * Наприкінці завжди додаються рядки про CLI `@nitra/cursor` (синхрон правил / programmatic check),
 * на початку — рекомендована команда `bun i` за конвенціями monorepo.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const PACKAGE_NAME = '@nitra/cursor'
const AGENTS_MD = 'AGENTS.md'

/** Порядок виводу скриптів із `package.json` (лише ті, що реально існують). */
const SCRIPT_KEYS_ORDER = /** @type {const} */ ([
  'test',
  'lint',
  'lint-js',
  'lint-text',
  'lint-ga',
  'lint-k8s',
  'lint-docker',
  'start',
  'dev',
  'build'
])

/**
 * Зчитує `scripts` з `package.json` у `projectRoot` або повертає порожній об'єкт.
 * @param {string} projectRoot абсолютний шлях до кореня репозиторію
 * @returns {Promise<Record<string, string>>} об'єкт скриптів
 */
async function readPackageScripts(projectRoot) {
  const pkgPath = join(projectRoot, 'package.json')
  if (!existsSync(pkgPath)) {
    return {}
  }
  try {
    const raw = await readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(raw)
    if (pkg && typeof pkg === 'object' && pkg.scripts && typeof pkg.scripts === 'object') {
      return /** @type {Record<string, string>} */ (pkg.scripts)
    }
  } catch {
    // некоректний JSON або IO — секція команд лишиться з мінімумом (bun i + npx)
  }
  return {}
}

/**
 * Повертає елементи для Mustache-секції `commands` у AGENTS.template.md.
 * @param {string} projectRoot абсолютний шлях до кореня репозиторію (зазвичай `process.cwd()`)
 * @returns {Promise<{ name: string }[]>} рядки з полем `name` для `expandMustacheSection`
 */
export async function buildAgentsCommandBulletItems(projectRoot) {
  const scripts = await readPackageScripts(projectRoot)
  const items = /** @type {{ name: string }[]} */ ([{ name: `- **Залежності**: \`bun i\`` }])

  const added = new Set()

  for (const key of SCRIPT_KEYS_ORDER) {
    if (typeof scripts[key] === 'string' && scripts[key].length > 0) {
      items.push({ name: `- **${key}**: \`bun run ${key}\`` })
      added.add(key)
    }
  }

  const lintExtraKeys = Object.keys(scripts)
    .filter(k => k.startsWith('lint-') && !added.has(k) && typeof scripts[k] === 'string')
    .toSorted((a, b) => a.localeCompare(b))

  for (const key of lintExtraKeys) {
    items.push({ name: `- **${key}**: \`bun run ${key}\`` })
    added.add(key)
  }

  items.push(
    {
      name: `- **Оновити правила та ${AGENTS_MD}** (після змін у правилах/шаблоні CLI): \`npx ${PACKAGE_NAME}\``
    },
    { name: `- **Перевірки правил (programmatic)**: \`npx ${PACKAGE_NAME} check\`` }
  )

  return items
}
