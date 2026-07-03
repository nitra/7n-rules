/**
 * Глобальна черга запусків `n-cursor lint`: у кожен момент виконується щонайбільше
 * один lint-процес на машину (per-user tmpdir), наступні чекають у черзі й
 * стартують після звільнення лока. Рішення spec-дискусії 2026-07-03 — лок один
 * на всі запуски, без прив'язки до робочого дерева і без винятку для `--no-fix`:
 *   - fix-запуски в одному дереві пишуть у ті самі файли (T0-автофікси, LLM-worker),
 *     а snapshot/rollback живе в пам'яті процесу і чужих мутацій не бачить;
 *   - detect-only читає дерево, яке паралельний fix мутує → нестабільні результати;
 *   - навіть диз'юнктні прогони конкурують за CPU/диск/локальну LLM.
 * `hook --post-tool-use` лок НЕ бере: він read-only, per-file і має відповідати
 * миттєво — черга за багатохвилинним fix-прогоном заблокувала б hooks редактора.
 *
 * Механіка — наявний {@link withLock} (mkdir-лок, перехоплення лока мертвого PID,
 * poll-черга, TTL-дедуп), але з двома відмінностями від per-rule використання
 * (`run-standard-lint.mjs`):
 *   - `cacheDir` у `os.tmpdir()` замість `<git-common-dir>` → скоуп machine-wide,
 *     а не per-repo;
 *   - fingerprint дедуплікації домішує варіант виклику (`--full`/`--no-fix`/rules/cwd),
 *     бо `lint js` (exit 0) не еквівалентний повному `lint` на тому ж дереві —
 *     інакше дедуп хибно пропускав би ширший прогін.
 *
 * На таймаут черги — fail-closed (кидає Error, top-level catch у `n-cursor.js`
 * друкує повідомлення й виходить із кодом 1), а не дефолтний `run-unlocked`:
 * мовчазний паралельний запуск — саме те, що черга має унеможливити.
 */
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { withLock } from '../../utils/with-lock.mjs'
import { worktreeFingerprint } from '../../utils/worktree-fingerprint.mjs'

/** Machine-wide директорія стану лока — спільна для всіх репо й worktree. */
const GLOBAL_CACHE_DIR = join(tmpdir(), 'n-cursor', 'lint-global')

/**
 * Поріг time-based staleness. Дефолтні 30 хв `withLock` небезпечні для довгих
 * `--full`-прогонів із LLM-ladder: живий лок старший за поріг «перехоплюється»
 * конкурентом і запуски знову йдуть паралельно. Краш/SIGKILL покриває PID-перевірка
 * (лок мертвого процесу знімається одразу), тож великий поріг лишається лише
 * запобіжником проти PID-reuse після перезавантаження.
 */
const STALE_THRESHOLD_MS = 6 * 3_600_000

/**
 * Fingerprint для TTL-дедуплікації: стан робочого дерева + варіант виклику lint.
 * null (→ дедуплікація вимкнена, черга працює) коли:
 *   - не в git-репо (worktreeFingerprint дасть null);
 *   - `--cwd` вказує не на процесний cwd — git-команди fingerprint-а виконуються
 *     у `process.cwd()`, тож знімок відповідав би не тому дереву, що лінтиться.
 * @param {{cwd: string, full: boolean, rules: string[], noFix: boolean}} variant осі виклику lint
 * @param {() => string | null} [getTreeFp] знімок дерева (ін'єкція для тестів)
 * @returns {string | null} sha256-hex або null, якщо дедуп не можна застосувати
 */
export function lintLockFingerprint(variant, getTreeFp = worktreeFingerprint) {
  if (variant.cwd !== processCwd()) return null
  const treeFp = getTreeFp()
  if (treeFp === null) return null
  const axes = { cwd: variant.cwd, full: variant.full, noFix: variant.noFix, rules: [...variant.rules].toSorted() }
  return createHash('sha256')
    .update(`${treeFp}\n${JSON.stringify(axes)}`)
    .digest('hex')
}

/**
 * Виконує `runFn` під глобальним lint-локом: чекає в черзі, якщо інший lint
 * уже працює; ідентичний повторний запуск на незміненому дереві дедуплікується.
 * @param {{cwd: string, full: boolean, rules: string[], noFix: boolean}} variant осі виклику lint (для дедуп-fingerprint)
 * @param {() => number | Promise<number>} runFn реальна робота lint; повертає exit code
 * @param {{ttl?: number, staleThreshold?: number, waitTimeout?: number, pollInterval?: number, cacheDir?: string, getFingerprint?: () => string | null}} [opts] override-и `withLock` (для тестів)
 * @returns {Promise<number>} exit code виконаного запуску (або 0 при дедуплікації)
 */
export function withGlobalLintLock(variant, runFn, opts = {}) {
  return withLock('lint-global', runFn, {
    cacheDir: GLOBAL_CACHE_DIR,
    staleThreshold: STALE_THRESHOLD_MS,
    onWaitTimeout: 'fail',
    getFingerprint: () => lintLockFingerprint(variant),
    ...opts
  })
}
