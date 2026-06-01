/**
 * Перевірка для фінального (runtime) stage на базі `nginxinc/nginx-unprivileged`.
 *
 * Образ `nginx-unprivileged` уже оголошує `USER 101` і `EXPOSE 8080`, тож у Dockerfile
 * **не повинно** бути жодних явних `USER`-інструкцій у цьому stage:
 *
 * - `USER root` (або `USER 0`) для білд-кроків перезатирає успадкований `USER 101`; якщо потім
 *   не повернути non-root — фінальний образ лишається root, і k8s із `runAsNonRoot: true` падає з
 *   `CreateContainerConfigError`. Повертати треба саме **числовим** UID (`USER 101`), бо kubelet не
 *   підтверджує non-root за іменем `nginx` — тож повернення `USER 101`/`USER nginx` у кінці stage
 *   є симптомом зайвого `USER root` на початку.
 * - Найбезпечніший канон — взагалі не виходити з-під дефолтного 101: ні `USER root`, ні
 *   switch-back. Будь-який явний `USER` у такому stage прапорцюється як зайвий.
 *
 * Крім того, `COPY`/`ADD` без `--chown` копіює файли власником root — їх не зможе читати дефолтний
 * non-root користувач (uid=101); тому в цьому stage кожен `COPY`/`ADD` має мати `--chown` (канон —
 * `--chown=nginx:nginx`).
 *
 * Це окрема гілка від генеричного non-root-правила (`addgroup/adduser` + `USER app` для alpine-бекендів,
 * див. `getNonRootRuntimeHint` у `../js/lint.mjs`): для nginx канон — навпаки, **відсутність** `USER`.
 *
 * Тригер — лише фінальний `FROM`, що базується на `nginxinc/nginx-unprivileged` (з урахуванням
 * `mirror.gcr.io/…`-префікса й будь-якого тега). Build-stage-и не чіпаємо — там root і tooling норма.
 *
 * Взірець структури base-image-специфічного чек-модуля — сусідній `./docker-mirror.mjs`.
 */
import { getFromImageToken } from './docker-mirror.mjs'

const NEWLINE_RE = /\r?\n/
const USER_LINE_RE = /^\s*USER\s+([^\s#]+)/iu
const COPY_ADD_RE = /^\s*(COPY|ADD)\b(.*)$/iu
const CHOWN_FLAG_RE = /(?:^|\s)--chown=/iu

/** Шлях репозиторію nginx-unprivileged (після зняття `mirror.gcr.io/`/`docker.io/`-префікса й тега/digest). */
const NGINX_UNPRIVILEGED_REPO_RE = /(?:^|\/)nginxinc\/nginx-unprivileged(?::|@|$)/iu

/**
 * Чи базується ref `FROM` на образі `nginxinc/nginx-unprivileged` (будь-який тег, з/без `mirror.gcr.io/`).
 * @param {string} image — токен образу після `FROM`
 * @returns {boolean} true, якщо це nginx-unprivileged
 */
export function isNginxUnprivilegedImage(image) {
  return NGINX_UNPRIVILEGED_REPO_RE.test((image || '').trim())
}

/**
 * @typedef {{ image: string, lines: Array<{ lineNo: number, text: string }> }} FinalStage
 */

/**
 * Виділяє фінальний (останній `FROM` … кінець файла) stage з номерами рядків.
 * @param {string} fileContent — вміст Dockerfile/Containerfile
 * @returns {FinalStage | null} фінальний stage або null, якщо `FROM` немає
 */
function getFinalStage(fileContent) {
  const lines = fileContent.split(NEWLINE_RE)
  /** @type {{ image: string, idx: number } | null} */
  let lastFrom = null
  for (const [idx, line] of lines.entries()) {
    const image = getFromImageToken(line)
    if (image) lastFrom = { image, idx }
  }
  if (!lastFrom) return null
  const stageLines = lines.slice(lastFrom.idx).map((text, i) => ({ lineNo: lastFrom.idx + i + 1, text }))
  return { image: lastFrom.image, lines: stageLines }
}

/**
 * Нормалізує токен `USER` (без лапок, lower-case, без зайвих пробілів).
 * @param {string} token — захоплений токен після `USER`
 * @returns {string} нормалізований токен
 */
function normalizeUserToken(token) {
  return token.replaceAll('"', '').replaceAll("'", '').trim().toLowerCase()
}

/**
 * Перевіряє фінальний nginx-unprivileged stage на зайві `USER` і `COPY`/`ADD` без `--chown`.
 *
 * Збирає всі порушення в один рядок (по одному пункту на рядок) — щоб один прогін показав і
 * `USER root`, і switch-back `USER 101`, і `COPY` без `--chown` одразу.
 * @param {string} fileContent — вміст Dockerfile/Containerfile
 * @returns {string | null} повідомлення помилки або null, якщо порушень немає / це не nginx-stage
 */
export function getNginxUnprivilegedUserHint(fileContent) {
  const stage = getFinalStage(fileContent)
  if (!stage) return null
  if (!isNginxUnprivilegedImage(stage.image)) return null

  /** @type {string[]} */
  const problems = []
  // Перший рядок stage — це сам FROM; USER/COPY у ньому неможливі, але цикл лишаємо загальним.
  for (const { lineNo, text } of stage.lines) {
    const u = text.match(USER_LINE_RE)
    if (u) {
      const token = normalizeUserToken(u[1])
      if (token === 'root' || token === '0') {
        problems.push(
          `рядок ${lineNo}: прибери \`USER ${u[1]}\` — у nginx-unprivileged не можна перемикатися на root (інакше фінальний образ лишиться root і k8s із runAsNonRoot впаде)`
        )
      } else if (token === '101' || token === 'nginx') {
        problems.push(
          `рядок ${lineNo}: прибери зайвий \`USER ${u[1]}\` — база nginx-unprivileged вже працює від uid=101 (повернення USER назад — симптом зайвого USER root)`
        )
      } else {
        problems.push(
          `рядок ${lineNo}: прибери явний \`USER ${u[1]}\` — база nginx-unprivileged вже працює від non-root (uid=101), окремий USER не потрібен`
        )
      }
      continue
    }
    const c = text.match(COPY_ADD_RE)
    if (c && !CHOWN_FLAG_RE.test(text)) {
      problems.push(
        `рядок ${lineNo}: додай \`--chown=nginx:nginx\` до \`${c[1].toUpperCase()}\` — статику має читати non-root користувач (uid=101)`
      )
    }
  }

  if (problems.length === 0) return null
  return problems.join('\n     - ')
}
