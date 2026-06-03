/**
 * Спільна логіка виклику hadolint для шляхів до Dockerfile (див. docker.mdc).
 *
 * Відносні шляхи з прямими слешами для контейнера; спочатку hadolint через
 * `ensureTool` (PATH → кеш → авто-install brew/scoop/GitHub Release), а якщо
 * авто-install відключено/не вдався — docker run з образом HADOLINT_IMAGE.
 * Використовується `./check.mjs` (check-docker) та `../../lint/lint.mjs` (run-docker).
 */
import { spawnSync } from 'node:child_process'
import { relative, sep } from 'node:path'

import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

/** Тег образу для резервного запуску (узгоджуй з docker.mdc). */
export const HADOLINT_IMAGE = 'hadolint/hadolint:v2.12.0'

/**
 * Відносний шлях від root з прямими слешами (hadolint у контейнері).
 * @param {string} root корінь
 * @param {string} absPath абсолютний шлях
 * @returns {string} відносний шлях з прямими слешами
 */
export function posixRel(root, absPath) {
  return relative(root, absPath).split(sep).join('/')
}

/**
 * Запуск hadolint: спочатку `ensureTool` (PATH/кеш/авто-install), інакше Docker.
 * @param {string} root корінь репозиторію
 * @param {string} absPath абсолютний шлях до Dockerfile
 * @returns {{ ok: boolean, stdout: string, stderr: string, via: string }} результат перевірки hadolint та канал запуску
 */
export function lintDockerfileWithHadolint(root, absPath) {
  const rel = posixRel(root, absPath)
  let hadolintPath = null
  try {
    hadolintPath = ensureTool('hadolint')
  } catch {
    // ensureTool кинув (авто-install відключено через N_CURSOR_NO_AUTO_INSTALL або не вдався) → docker-fallback нижче
  }
  if (hadolintPath) {
    const local = spawnSync(hadolintPath, [rel], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    })
    const ok = local.status === 0
    return {
      ok,
      stdout: local.stdout ?? '',
      stderr: local.stderr ?? '',
      via: 'hadolint'
    }
  }

  const dockerPath = resolveCmd('docker')
  if (!dockerPath) {
    return {
      ok: false,
      stdout: '',
      stderr:
        'Не знайдено hadolint у PATH і не знайдено docker у PATH. ' +
        'Встанови hadolint (наприклад brew install hadolint) або Docker (див. docker.mdc).',
      via: 'docker'
    }
  }

  const docker = spawnSync(
    dockerPath,
    ['run', '--rm', '-v', `${root}:/workdir`, '-w', '/workdir', HADOLINT_IMAGE, rel],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }
  )
  if (docker.error) {
    return {
      ok: false,
      stdout: '',
      stderr:
        `Не знайдено hadolint у PATH і не вдалося запустити Docker (${docker.error.message}). ` +
        `Встанови hadolint (наприклад brew install hadolint) або Docker (див. docker.mdc).`,
      via: 'docker'
    }
  }
  const ok = docker.status === 0
  return {
    ok,
    stdout: docker.stdout ?? '',
    stderr: docker.stderr ?? '',
    via: 'docker'
  }
}
