/** @see ./docs/provider.md */
import { existsSync } from 'node:fs'
import { copyFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

import { collectUvDiff, listDirectDependencies } from './uv-diff.mjs'

/** Суфікс бекапу — той самий, що й для package.json/Cargo.toml у ядрі. */
const BACKUP_SUFFIX = '.taze-bak'

/**
 * Промпт ОДНОГО ітеративного виклику для Python-пакета (кроки 4-6 SKILL.md,
 * Python-гілка) для ОДНОГО major-пакета. Кроки 1-3/7/8 виконує оркестратор
 * ядра детерміновано, без LLM.
 * @param {{manifest: string, pkg: string, from: string, to: string}} entry запис major-diff (з `collectUvDiff`)
 * @returns {string} готовий промпт
 */
export function buildUvDependencyPrompt({ manifest, pkg, from, to }) {
  return [
    '# Major-оновлення одного Python-пакета: перевірка сумісності й рефакторинг',
    '',
    `Пакет \`${pkg}\` у \`${manifest}\`: **${from} → ${to}** — вже застосовано (\`uv remove\` + \`uv add --bounds lower\` виконано детерміновано, без тебе). Твоя задача — лише breaking-changes-перевірка й, за потреби, рефакторинг.`,
    '',
    '## Кроки',
    `1. Зібрати breaking changes цього оновлення: CHANGELOG/Releases репозиторію пакета (адреса — зі сторінки https://pypi.org/project/${pkg}/) між ${from} і ${to}.`,
    `2. Знайти використання зачепленого API в коді проєкту (\`rg -n --type py\` по імпортах/викликах \`${pkg}\`).`,
    '3. Сумісно — нічого не робити. Несумісно — застосувати міграцію (перейменувати імпорт, оновити сигнатуру виклику, замінити видалений параметр еквівалентом).',
    '4. Якщо були правки — запусти наявні в проєкті лінт/typecheck/test (`ruff`/`mypy`/`pytest` тощо — залежно від того, що реально налаштовано).',
    '5. Нетривіальна/неоднозначна міграція — не вгадуй, залиш TODO-коментар із посиланням на CHANGELOG.',
    '',
    'У відповіді одним абзацом підсумуй: сумісно / зрефакторено (які файли) / TODO (чому).'
  ].join('\n')
}

/**
 * Знаходить кореневий `pyproject.toml` (крок 0.2 SKILL.md, Python-гілка).
 * v1: один кореневий файл, не per-package обхід, як для Cargo.toml —
 * поточна uv-конвенція (single-project, без workspace-обходу).
 * @param {string} cwd корінь репо
 * @returns {string[]} `['pyproject.toml']`, якщо файл існує, інакше `[]`
 */
export function findPyprojectManifest(cwd) {
  return existsSync(join(cwd, 'pyproject.toml')) ? ['pyproject.toml'] : []
}

/**
 * Бекапить pyproject.toml + uv.lock (крок 1 SKILL.md, Python-гілка) —
 * потрібно для класифікації major/minor через `collectUvDiff` після bump-у.
 * @param {string} cwd корінь репо
 * @param {{ copyFile?: (src: string, dest: string) => Promise<void> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function backupUvManifest(cwd, deps = {}) {
  const copy = deps.copyFile ?? copyFile
  const pyprojectPath = join(cwd, 'pyproject.toml')
  if (existsSync(pyprojectPath)) await copy(pyprojectPath, `${pyprojectPath}${BACKUP_SUFFIX}`)
  const lockPath = join(cwd, 'uv.lock')
  if (existsSync(lockPath)) await copy(lockPath, `${lockPath}${BACKUP_SUFFIX}`)
}

/**
 * Прибирає бекапи pyproject.toml/uv.lock після завершення (крок 7 SKILL.md,
 * Python-гілка).
 * @param {string} cwd корінь репо
 * @param {{ rm?: (path: string, opts?: object) => Promise<void> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function cleanupUvBackups(cwd, deps = {}) {
  const remove = deps.rm ?? rm
  await remove(join(cwd, `pyproject.toml${BACKUP_SUFFIX}`), { force: true })
  await remove(join(cwd, `uv.lock${BACKUP_SUFFIX}`), { force: true })
}

/**
 * Піднімає кожну пряму залежність pyproject.toml через `uv remove` + `uv add
 * <pkg>[extras] --bounds lower` (крок 2 SKILL.md, Python-гілка) — `uv` не
 * має єдиної команди "підняти все до latest, навіть через major", на
 * відміну від `bunx taze -w -r latest`/`cargo upgrade --incompatible allow`
 * (підтверджено емпірично: `uv add <pkg>` на вже присутній залежності —
 * no-op, specifier НЕ переписується без попереднього `uv remove`). Провал
 * одного пакета (мережа/резолюція) не втрачає прогрес по інших —
 * best-effort відновлення оригінального рядка, якщо `uv add` не вдався
 * після `uv remove`.
 * @param {string} cwd корінь репо
 * @param {import('@7n/rules/plugin-api').SpawnFn} spawnFn spawnSync-сумісний виклик
 * @param {(line: string) => void} log колбек прогресу
 * @param {{ readFile?: (path: string, encoding: string) => Promise<string> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function bumpUvDependencies(cwd, spawnFn, log, deps = {}) {
  const read = deps.readFile ?? readFile
  const text = await read(join(cwd, 'pyproject.toml'), 'utf8')
  const manifest = parseToml(text)
  const directDeps = listDirectDependencies(manifest)

  for (const dep of directDeps) {
    const pkgSpec = dep.extras.length > 0 ? `${dep.name}[${dep.extras.join(',')}]` : dep.name
    const removeResult = spawnFn('uv', ['remove', dep.name], { cwd, encoding: 'utf8' })
    if (removeResult.status !== 0) {
      log(`  ⚠️ uv remove ${dep.name}: ${removeResult.stderr || removeResult.stdout}`)
      continue
    }
    const addResult = spawnFn('uv', ['add', pkgSpec, '--bounds', 'lower'], { cwd, encoding: 'utf8' })
    if (addResult.status !== 0) {
      log(`  ⚠️ uv add ${pkgSpec}: ${addResult.stderr || addResult.stdout} — відновлюю ${dep.raw}`)
      spawnFn('uv', ['add', dep.raw], { cwd, encoding: 'utf8' })
    }
  }
}

/**
 * EcosystemProvider Python/uv для taze-оркестратора ядра — контракт
 * `@7n/rules/plugin-api`, реєструється маніфестом package.json плагіна
 * (`n-rules.contributes.handlers.taze`).
 * @type {import('@7n/rules/plugin-api').EcosystemProvider}
 */
export const pythonProvider = {
  id: 'python-uv',
  title: 'Python-пакети (uv)',
  manifestNoun: 'pyproject.toml',
  skillSection: 'Python-гілкою SKILL.md',
  detect: cwd => findPyprojectManifest(cwd),
  available: spawnFn =>
    spawnFn('uv', ['--version'], { encoding: 'utf8' }).status === 0
      ? { ok: true, reason: null }
      : { ok: false, reason: '`uv` не встановлено (https://docs.astral.sh/uv/getting-started/installation/)' },
  backup: (cwd, manifests, deps) => backupUvManifest(cwd, deps),
  bump: (cwd, manifests, { spawnFn, log, deps }) => bumpUvDependencies(cwd, spawnFn, log, deps),
  diff: cwd => collectUvDiff(cwd),
  promptFor: buildUvDependencyPrompt,
  cleanup: (cwd, manifests, deps) => cleanupUvBackups(cwd, deps)
}

export default pythonProvider
