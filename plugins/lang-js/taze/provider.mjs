/** @see ./docs/provider.md */
import { existsSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { getMonorepoPackageRootDirs } from '@7n/rules/scripts/lib/workspaces.mjs'

import { collectTazeDiff } from './diff.mjs'

// CLI `n-rules taze diff` ядра резолвить цей handler-модуль і кличе runTazeCli.
export { runTazeCli } from './diff.mjs'

/** Суфікс бекапу — той самий, що й у `diff.mjs`/кроці 1 SKILL.md. */
const BACKUP_SUFFIX = '.taze-bak'

/**
 * Промпт ОДНОГО ітеративного виклику для npm/bun-пакета (кроки 4-6 SKILL.md)
 * для ОДНОГО major-запису. Кроки 1-3/7/8 виконує оркестратор ядра
 * детерміновано, без LLM.
 * @param {{manifest: string, pkg: string, from: string, to: string}} entry запис major-diff (з `collectTazeDiff`, workspace → manifest)
 * @returns {string} готовий промпт
 */
export function buildDependencyPrompt({ manifest, pkg, from, to }) {
  return [
    '# Major-оновлення одного пакета: перевірка сумісності й рефакторинг',
    '',
    `Пакет \`${pkg}\` у воркспейсі \`${manifest}\`: **${from} → ${to}** — вже застосовано в package.json/bun.lock (кроки 1-3 виконано детерміновано, без тебе). Твоя задача — лише breaking-changes-перевірка й, за потреби, рефакторинг.`,
    '',
    '## Кроки',
    `1. Зібрати breaking changes цього оновлення: CHANGELOG/Releases репозиторію модуля (поле \`repository\` у \`node_modules/${pkg}/package.json\`), або git/diff між закешованою старою версією (\`~/.bun/install/cache/${pkg}@<стара-версія>/\`) і новою (\`node_modules/${pkg}/\`).`,
    `2. Знайти використання зачепленого API в коді проєкту (\`rg -n\` по імпортах/викликах \`${pkg}\`).`,
    '3. Сумісно — нічого не робити. Несумісно — застосувати міграцію (перейменувати імпорт, оновити сигнатуру виклику, замінити видалену опцію еквівалентом).',
    '4. Якщо були правки — запусти `npx @7n/rules lint`, typecheck/test якщо є в проєкті.',
    '5. Нетривіальна/неоднозначна міграція — не вгадуй, залиш TODO-коментар із посиланням на CHANGELOG.',
    '',
    'У відповіді одним абзацом підсумуй: сумісно / зрефакторено (які файли) / TODO (чому).'
  ].join('\n')
}

/**
 * Бекапить package.json кожного воркспейсу (крок 1 SKILL.md) — потрібно для
 * класифікації major/minor через `collectTazeDiff` після bump-у.
 * @param {string} cwd корінь репо
 * @param {{ getMonorepoPackageRootDirs?: (cwd: string) => Promise<string[]>, copyFile?: (src: string, dest: string) => Promise<void> }} [deps] інжекти
 * @returns {Promise<string[]>} відносні шляхи воркспейсів, що мали package.json
 */
export async function backupWorkspacePackageFiles(cwd, deps = {}) {
  const getRoots = deps.getMonorepoPackageRootDirs ?? getMonorepoPackageRootDirs
  const copy = deps.copyFile ?? copyFile
  const roots = await getRoots(cwd)
  const backedUp = []
  for (const ws of roots) {
    const pkgPath = join(cwd, ws, 'package.json')
    if (!existsSync(pkgPath)) continue
    await copy(pkgPath, `${pkgPath}${BACKUP_SUFFIX}`)
    backedUp.push(ws)
  }
  return backedUp
}

/**
 * Прибирає бекапи package.json усіх воркспейсів (крок 7 SKILL.md).
 * @param {string} cwd корінь репо
 * @param {{ getMonorepoPackageRootDirs?: (cwd: string) => Promise<string[]>, rm?: (path: string, opts?: object) => Promise<void> }} [deps] інжекти
 * @returns {Promise<void>}
 */
export async function cleanupWorkspaceBackups(cwd, deps = {}) {
  const getRoots = deps.getMonorepoPackageRootDirs ?? getMonorepoPackageRootDirs
  const remove = deps.rm ?? rm
  for (const ws of await getRoots(cwd)) {
    await remove(join(cwd, ws, `package.json${BACKUP_SUFFIX}`), { force: true })
  }
}

/**
 * Виконує детерміновану команду npm-гілки, кидає з exit-кодом+stderr при провалі.
 * @param {string} cmd бінарник
 * @param {string[]} args аргументи
 * @param {string} cwd робочий каталог
 * @param {import('@7n/rules/plugin-api').SpawnFn} spawnFn spawnSync-сумісний виклик
 * @returns {void}
 */
function runCommand(cmd, args, cwd, spawnFn) {
  const result = spawnFn(cmd, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} → exit ${result.status}: ${result.stderr || result.stdout}`)
  }
}

/**
 * EcosystemProvider npm/bun для taze-оркестратора ядра (фаза 5a spec
 * lang-plugins-extraction: ядро — двигун без мовної специфіки, JS-екосистема —
 * такий самий плагін, як Rust/Python). Контракт `@7n/rules/plugin-api`,
 * реєструється маніфестом (`n-rules.contributes.handlers.taze`).
 * `diff.major` записи мапляться workspace → manifest (контракт порту).
 * @type {import('@7n/rules/plugin-api').EcosystemProvider}
 */
const jsProvider = {
  id: 'js-bun',
  title: 'npm/bun-пакети',
  manifestNoun: 'package.json',
  skillSection: 'npm/bun-гілкою SKILL.md',
  detect: cwd => (existsSync(join(cwd, 'package.json')) ? ['package.json'] : []),
  available: spawnFn =>
    spawnFn('bun', ['--version'], { encoding: 'utf8' }).status === 0
      ? { ok: true, reason: null }
      : { ok: false, reason: '`bun` не встановлено (https://bun.sh) — npm/bun-гілка потребує bun/bunx' },
  backup: async (cwd, manifests, deps) => {
    await backupWorkspacePackageFiles(cwd, deps)
  },
  bump: (cwd, manifests, { spawnFn, log }) => {
    log('⬆️  bunx taze -w -r latest...')
    runCommand('bunx', ['taze', '-w', '-r', 'latest'], cwd, spawnFn)
    log('📥 bun install...')
    runCommand('bun', ['install'], cwd, spawnFn)
    return Promise.resolve()
  },
  diff: async cwd => {
    const diff = await collectTazeDiff(cwd)
    return {
      major: diff.major.map(({ workspace, pkg, from, to }) => ({ manifest: workspace, pkg, from, to })),
      minorPatch: diff.minorPatch,
      totalChanged: diff.totalChanged
    }
  },
  promptFor: buildDependencyPrompt,
  cleanup: (cwd, manifests, deps) => cleanupWorkspaceBackups(cwd, deps)
}

/** Default-експорт handler-модуля taze: обʼєкт `jsProvider` (опис вище). */
export default jsProvider
