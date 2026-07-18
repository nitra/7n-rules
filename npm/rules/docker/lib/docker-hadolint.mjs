/**
 * Спільна логіка виклику hadolint для шляхів до Dockerfile (див. docker.mdc).
 *
 * Відносні шляхи з прямими слешами; hadolint резолвиться через `ensureTool`
 * (PATH → кеш → авто-install brew/scoop/GitHub Release per-platform). Docker-fallback
 * прибрано — hadolint ставиться як **нативний бінарник**, без `docker run`.
 * Використовується `../js/lint.mjs` (правило `n-rules lint docker` / check-docker).
 */
import { relative, sep } from 'node:path'

import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/**
 * Відносний шлях від root з прямими слешами (стабільний вивід незалежно від OS).
 * @param {string} root корінь
 * @param {string} absPath абсолютний шлях
 * @returns {string} відносний шлях з прямими слешами
 */
export function posixRel(root, absPath) {
  return relative(root, absPath).split(sep).join('/')
}

/**
 * Запуск hadolint як нативного бінарника. hadolint резолвиться через `ensureTool`
 * (PATH → кеш → авто-install); якщо авто-install відключено (`N_CURSOR_NO_AUTO_INSTALL`)
 * чи не вдався — повертаємо `ok: false` з підказкою (без `docker run`).
 * @param {string} root корінь репозиторію
 * @param {string} absPath абсолютний шлях до Dockerfile
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, via: string }>} результат перевірки hadolint
 */
export async function lintDockerfileWithHadolint(root, absPath) {
  const rel = posixRel(root, absPath)
  let hadolintPath
  try {
    hadolintPath = ensureTool('hadolint')
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr:
        `Не вдалося отримати hadolint (${error.message}). ` +
        'Встанови: brew install hadolint (macOS) / scoop install hadolint (Windows) / ' +
        'https://github.com/hadolint/hadolint/releases (Linux).',
      via: 'hadolint'
    }
  }

  const local = await spawnAsync(hadolintPath, [rel], {
    cwd: root
  })
  return {
    ok: local.exitCode === 0,
    stdout: local.stdout ?? '',
    stderr: local.stderr ?? '',
    via: 'hadolint'
  }
}
