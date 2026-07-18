/** @see ./docs/rust-provider.md */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { collectCargoDiff } from './cargo-diff.mjs'

/** Суфікс бекапу — той самий, що й для package.json (крок 1 SKILL.md, Rust-гілка). */
const BACKUP_SUFFIX = '.taze-bak'

/**
 * Промпт ОДНОГО ітеративного виклику для Rust-крейта (кроки 4-6 SKILL.md,
 * Rust-гілка) для ОДНОГО major-крейта. Кроки 1-3/7/8 виконує оркестратор
 * детерміновано, без LLM.
 * @param {{manifest: string, pkg: string, from: string, to: string}} entry запис major-diff (з `collectCargoDiff`)
 * @returns {string} готовий промпт
 */
export function buildCargoDependencyPrompt({ manifest, pkg, from, to }) {
  return [
    '# Major-оновлення одного Rust-крейта: перевірка сумісності й рефакторинг',
    '',
    `Крейт \`${pkg}\` у \`${manifest}\`: **${from} → ${to}** — вже застосовано в Cargo.toml/Cargo.lock (кроки 1-3 виконано детерміновано, без тебе). Твоя задача — лише breaking-changes-перевірка й, за потреби, рефакторинг.`,
    '',
    '## Кроки',
    `1. Зібрати breaking changes цього оновлення: адреса репозиторію з поля \`repository\`/\`documentation\` крейта на crates.io (https://crates.io/crates/${pkg}) — CHANGELOG.md репозиторію чи GitHub Releases. Якщо немає — різниця по публічному API (\`pub fn\`/\`pub struct\`/\`pub trait\`) між закешованою старою версією (\`~/.cargo/registry/src/*/${pkg}-<стара-версія>/\`) і новою.`,
    `2. Знайти використання зачепленого API в коді проєкту (\`rg -n --type rust\` по use-шляхах/викликах \`${pkg}\`).`,
    '3. Сумісно — нічого не робити. Несумісно — застосувати міграцію (перейменувати use-шлях, оновити сигнатуру виклику, замінити видалений макрос еквівалентом).',
    '4. Якщо були правки — запусти `cargo fmt --all -- --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test`.',
    '5. Нетривіальна/неоднозначна міграція — не вгадуй, залиш TODO-коментар із посиланням на CHANGELOG.',
    '',
    'У відповіді одним абзацом підсумуй: сумісно / зрефакторено (які файли) / TODO (чому).'
  ].join('\n')
}

/**
 * Знаходить Cargo.toml поза node_modules/.worktrees/target (крок 0.2 SKILL.md).
 * @param {string} cwd корінь репо
 * @param {{ spawnFn?: (cmd: string, args: string[], opts?: object) => { status: number|null, stdout: string, stderr: string } }} deps інжект зі spawnSync-сумісним викликом
 * @returns {string[]} відносні шляхи знайдених Cargo.toml
 */
export function findCargoManifests(cwd, deps = {}) {
  const spawnFn = deps.spawnFn ?? spawnSync
  const result = spawnFn(
    'find',
    [
      '.',
      '-name',
      'Cargo.toml',
      '-not',
      '-path',
      '*/node_modules/*',
      '-not',
      '-path',
      '*/.worktrees/*',
      '-not',
      '-path',
      '*/target/*'
    ],
    { cwd, encoding: 'utf8' }
  )
  return (result.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

/**
 * Чи встановлений cargo-edit (дає `cargo upgrade`) — без нього неможливо
 * детерміновано перетнути major-межу Rust-залежностей (голий `cargo update`
 * піднімає лише semver-сумісні версії; SKILL.md §Передумови).
 * @param {import('../../../scripts/lib/plugin-api.mjs').SpawnFn} spawnFn spawnSync-сумісний виклик
 * @returns {boolean} true — `cargo upgrade` доступна
 */
function hasCargoEdit(spawnFn) {
  return spawnFn('cargo', ['upgrade', '--version'], { encoding: 'utf8' }).status === 0
}

/**
 * Бекапить кожен Cargo.toml + спільний кореневий Cargo.lock (крок 1 SKILL.md,
 * Rust-гілка). v1: один спільний workspace/Cargo.lock у корені `cwd` —
 * поточна реальна топологія репо; кілька незалежних Cargo-workspace поки не
 * підтримується.
 * @param {string} cwd корінь репо
 * @param {string[]} manifestPaths відносні шляхи Cargo.toml (з `findCargoManifests`)
 * @param {{ copyFile?: (src: string, dest: string) => Promise<void> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function backupCargoManifests(cwd, manifestPaths, deps = {}) {
  const copy = deps.copyFile ?? copyFile
  for (const manifest of manifestPaths) {
    const manifestPath = join(cwd, manifest)
    if (existsSync(manifestPath)) await copy(manifestPath, `${manifestPath}${BACKUP_SUFFIX}`)
  }
  const lockPath = join(cwd, 'Cargo.lock')
  if (existsSync(lockPath)) await copy(lockPath, `${lockPath}${BACKUP_SUFFIX}`)
}

/**
 * Прибирає бекапи Cargo.toml/Cargo.lock після завершення (крок 7 SKILL.md,
 * Rust-гілка).
 * @param {string} cwd корінь репо
 * @param {string[]} manifestPaths відносні шляхи Cargo.toml (з `findCargoManifests`)
 * @param {{ rm?: (path: string, opts?: object) => Promise<void> }} [deps] інжект
 * @returns {Promise<void>}
 */
export async function cleanupCargoBackups(cwd, manifestPaths, deps = {}) {
  const remove = deps.rm ?? rm
  for (const manifest of manifestPaths) {
    await remove(join(cwd, `${manifest}${BACKUP_SUFFIX}`), { force: true })
  }
  await remove(join(cwd, `Cargo.lock${BACKUP_SUFFIX}`), { force: true })
}

/**
 * Виконує cargo-команду, кидає з exit-кодом+stderr при провалі.
 * @param {string[]} args аргументи cargo
 * @param {string} cwd робочий каталог
 * @param {import('../../../scripts/lib/plugin-api.mjs').SpawnFn} spawnFn spawnSync-сумісний виклик
 * @returns {void}
 */
function runCargo(args, cwd, spawnFn) {
  const result = spawnFn('cargo', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`cargo ${args.join(' ')} → exit ${result.status}: ${result.stderr || result.stdout}`)
  }
}

/**
 * Вбудований (first-party) EcosystemProvider Rust/Cargo для taze-оркестратора —
 * форма контракту `@7n/rules/plugin-api`. Лишається в ядрі до фази 2
 * (spec 2026-07-18-lang-plugins-extraction), далі виїде в `@7n/rules-lang-rust`.
 * @type {import('../../../scripts/lib/plugin-api.mjs').EcosystemProvider}
 */
const rustProvider = {
  id: 'rust-cargo',
  title: 'Rust-крейти',
  manifestNoun: 'Cargo.toml',
  skillSection: 'Rust-гілкою SKILL.md',
  detect: (cwd, deps) => findCargoManifests(cwd, deps),
  available: spawnFn =>
    hasCargoEdit(spawnFn)
      ? { ok: true, reason: null }
      : {
          ok: false,
          reason:
            'cargo-edit не встановлено (`cargo install cargo-edit`) — cargo update без нього недетермінований для major'
        },
  backup: backupCargoManifests,
  bump: (cwd, manifests, { spawnFn, log }) => {
    log('⬆️  cargo upgrade --incompatible allow...')
    runCargo(['upgrade', '--incompatible', 'allow'], cwd, spawnFn)
    log('🔄 cargo update...')
    runCargo(['update'], cwd, spawnFn)
    return Promise.resolve()
  },
  diff: (cwd, manifests) => collectCargoDiff(cwd, manifests),
  promptFor: buildCargoDependencyPrompt,
  cleanup: cleanupCargoBackups
}

export default rustProvider
