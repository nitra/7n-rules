/** @see ./docs/provider.md */
import { existsSync } from 'node:fs'
import { copyFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { collectComposerDiff, listDirectComposerDependencies } from './composer-diff.mjs'

/** Суфікс бекапу — той самий, що й для package.json/pyproject.toml/Cargo.toml. */
const BACKUP_SUFFIX = '.taze-bak'

/**
 * Промпт ОДНОГО ітеративного виклику для PHP-пакета (кроки 4-6 SKILL.md, PHP-гілка) для ОДНОГО
 * major-пакета. Кроки 1-3/7/8 виконує оркестратор ядра детерміновано, без LLM.
 * @param {{manifest: string, pkg: string, from: string, to: string}} entry запис major-diff (з `collectComposerDiff`)
 * @returns {string} готовий промпт
 */
export function buildComposerDependencyPrompt({ manifest, pkg, from, to }) {
  return [
    '# Major-оновлення одного PHP-пакета: перевірка сумісності й рефакторинг',
    '',
    `Пакет \`${pkg}\` у \`${manifest}\`: **${from} → ${to}** — вже застосовано (\`composer require\` виконано детерміновано, без тебе). Твоя задача — лише breaking-changes-перевірка й, за потреби, рефакторинг.`,
    '',
    '## Кроки',
    `1. Зібрати breaking changes цього оновлення: CHANGELOG/Releases репозиторію пакета (адреса — зі сторінки https://packagist.org/packages/${pkg}) між ${from} і ${to}.`,
    `2. Знайти використання зачепленого API в коді проєкту (\`rg -n --type php\` по use-шляхах/викликах \`${pkg}\`).`,
    '3. Сумісно — нічого не робити. Несумісно — застосувати міграцію (перейменувати use-шлях, оновити сигнатуру виклику, замінити видалений метод еквівалентом).',
    '4. Якщо були правки — запусти наявні в проєкті лінт/статичний аналіз/test (`mago lint`/`mago analyze`/`phpunit` тощо — залежно від того, що реально налаштовано).',
    '5. Нетривіальна/неоднозначна міграція — не вгадуй, залиш TODO-коментар із посиланням на CHANGELOG.',
    '',
    'У відповіді одним абзацом підсумуй: сумісно / зрефакторено (які файли) / TODO (чому).'
  ].join('\n')
}

/**
 * Знаходить кореневий `composer.json` (той самий root-only автодетект-конвенція, що й
 * `rules/php/project/main.mjs`). v1: один кореневий файл, без обходу вкладених workspaces —
 * окрема фіча, не цей скоуп.
 * @param {string} cwd корінь репо
 * @returns {string[]} `['composer.json']`, якщо файл існує, інакше `[]`
 */
export function findComposerManifest(cwd) {
  return existsSync(join(cwd, 'composer.json')) ? ['composer.json'] : []
}

/**
 * Бекапить composer.json + composer.lock (крок 1 SKILL.md, PHP-гілка) — потрібно для
 * класифікації major/minor через `collectComposerDiff` після bump-у.
 * @param {string} cwd корінь репо
 * @param {{ copyFile?: (src: string, dest: string) => Promise<void> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function backupComposerManifest(cwd, deps = {}) {
  const copy = deps.copyFile ?? copyFile
  const composerJsonPath = join(cwd, 'composer.json')
  if (existsSync(composerJsonPath)) await copy(composerJsonPath, `${composerJsonPath}${BACKUP_SUFFIX}`)
  const lockPath = join(cwd, 'composer.lock')
  if (existsSync(lockPath)) await copy(lockPath, `${lockPath}${BACKUP_SUFFIX}`)
}

/**
 * Прибирає бекапи composer.json/composer.lock після завершення (крок 7 SKILL.md, PHP-гілка).
 * @param {string} cwd корінь репо
 * @param {{ rm?: (path: string, opts?: object) => Promise<void> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function cleanupComposerBackups(cwd, deps = {}) {
  const remove = deps.rm ?? rm
  await remove(join(cwd, `composer.json${BACKUP_SUFFIX}`), { force: true })
  await remove(join(cwd, `composer.lock${BACKUP_SUFFIX}`), { force: true })
}

/**
 * Піднімає кожну пряму залежність composer.json через `composer require <pkg> --with-all-dependencies
 * --no-interaction` (крок 2 SKILL.md, PHP-гілка) — Composer, як і `uv`, **не має** єдиної команди
 * "підняти все до latest, навіть через major": `composer update` (навіть із `--with-all-dependencies`)
 * лишається в межах ІСНУЮЧОГО constraint-у в composer.json (напр. `^7.4` ніколи не перескочить на
 * `8.x` через `update`) — офіційно задокументована поведінка Composer, на відміну від
 * `bunx taze -w -r latest`/`cargo upgrade --incompatible allow`. `composer require <pkg>` без
 * версії, навіть якщо пакет вже присутній, змушує Composer заново резолвити НАЙНОВІШУ версію, що
 * задовольняє stability-налаштування, і переписати constraint у composer.json — той самий підхід,
 * що й "запросити пакет знову" для форс-бампу, паралель до `uv remove`+`uv add` (там Composer не
 * потребує окремого `remove` — сам `require` перезаписує constraint без проміжного стану).
 * `--dev` для записів `require-dev`. Провал одного пакета (мережа/резолюція) не втрачає прогрес
 * по інших — Composer сам не застосовує часткову зміну composer.json при провалі `require`.
 * @param {string} cwd корінь репо
 * @param {import('@7n/rules/plugin-api').SpawnFn} spawnFn spawnSync-сумісний виклик
 * @param {(line: string) => void} log колбек прогресу
 * @param {{ readFile?: (path: string, encoding: string) => Promise<string> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function bumpComposerDependencies(cwd, spawnFn, log, deps = {}) {
  const read = deps.readFile ?? readFile
  const text = await read(join(cwd, 'composer.json'), 'utf8')
  const manifest = JSON.parse(text)
  const directDeps = listDirectComposerDependencies(manifest)

  for (const dep of directDeps) {
    const args = dep.dev
      ? ['require', '--dev', dep.name, '--with-all-dependencies', '--no-interaction']
      : ['require', dep.name, '--with-all-dependencies', '--no-interaction']
    const result = spawnFn('composer', args, { cwd, encoding: 'utf8' })
    if (result.status !== 0) {
      log(`  ⚠️ composer ${args.join(' ')}: ${result.stderr || result.stdout}`)
    }
  }
}

/**
 * EcosystemProvider PHP/Composer для taze-оркестратора ядра — контракт `@7n/rules/plugin-api`,
 * реєструється contribution-ою `taze.provider@1` (id `taze-php`).
 * @type {import('@7n/rules/plugin-api').EcosystemProvider}
 */
const phpProvider = {
  id: 'php-composer',
  title: 'PHP-пакети (Composer)',
  manifestNoun: 'composer.json',
  skillSection: 'PHP-гілкою SKILL.md',
  detect: cwd => findComposerManifest(cwd),
  available: spawnFn =>
    spawnFn('composer', ['--version'], { encoding: 'utf8' }).status === 0
      ? { ok: true, reason: null }
      : { ok: false, reason: '`composer` не встановлено (https://getcomposer.org/download/)' },
  backup: (cwd, manifests, deps) => backupComposerManifest(cwd, deps),
  bump: (cwd, manifests, { spawnFn, log, deps }) => bumpComposerDependencies(cwd, spawnFn, log, deps),
  diff: cwd => collectComposerDiff(cwd),
  promptFor: buildComposerDependencyPrompt,
  cleanup: (cwd, manifests, deps) => cleanupComposerBackups(cwd, deps)
}

/** Default-експорт handler-модуля taze: обʼєкт `phpProvider` (опис вище). */
export default phpProvider
