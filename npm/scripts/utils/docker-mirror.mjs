/**
 * Визначає, чи рядок `FROM` у Dockerfile використовує образи
 * `oven/bun`, `alpine`, `nginx`, `node` з Docker Hub без дзеркала
 * `mirror.gcr.io` (GCR mirror).
 *
 * Правило застосовується лише до тих самих звернень, що виглядають як
 * pull з Docker Hub (короткі імена, `docker.io/…`); приватні реєстри
 * (hostname у першому сегменті) не оцінюються.
 *
 * Канонічні заміни: `mirror.gcr.io/oven/bun` та
 * `mirror.gcr.io/library/{alpine,nginx,node}`.
 */

/**
 * @param {string} t — токен образу в лапках або без
 * @returns {string} токен без зовнішніх лапок
 */
function stripFromImageQuotes(t) {
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'")) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * Виділяє токен образу з рядка `FROM` (після зняття inline-коментаря, без AS).
 * Підтримує прапорець `--platform=…` і форму `--platform` + значення.
 *
 * @param {string} line — рядок Dockerfile
 * @returns {string | null} токен образу або null, якщо рядок не `FROM`
 */
export function getFromImageToken(line) {
  const withoutComment = line.split('#')[0].trim()
  if (!withoutComment) return null
  const m = withoutComment.match(/^\s*FROM\s+(.+)$/i)
  if (!m) return null
  const raw = m[1].trim()
  const tokenRe = /(?:[^\s"]+|"[^"]*")+/g
  const tokens = raw.match(tokenRe) || []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === '--platform' || t.startsWith('--platform=')) {
      if (t.startsWith('--platform=')) {
        i += 1
      } else if (tokens[i + 1] === undefined) {
        i += 1
      } else {
        i += 2
      }
    } else if (t === '--' || t.toUpperCase() === 'AS') {
      break
    } else if (t.startsWith('--') && t.includes('=')) {
      i += 1
    } else if (t.startsWith('--')) {
      i += 1
    } else {
      return stripFromImageQuotes(t)
    }
  }
  return null
}

/**
 * Схоже на звернення до Docker Hub (коротке ім’я, `docker.io/…`, не mirror.gcr.io).
 * Не вважати Hub: явний чужий реєстр (`gcr.io/…`, `reg.example.com:5000/…`).
 *
 * @param {string} imageToken — ref образу (FROM)
 * @returns {boolean} true, якщо схоже на pull з Docker Hub
 */
export function isDockerHubStyleImageRef(imageToken) {
  if (!imageToken) return false
  if (/^mirror\.gcr\.io\//i.test(imageToken)) return false
  const noDigest = imageToken.split('@')[0] || ''
  if (!noDigest.includes('/')) {
    return true
  }
  const first = noDigest.split('/')[0] || ''
  if (first === 'docker.io' || first === 'index.docker.io') return true
  if (first.includes('.')) return false
  if (first === 'localhost' || /^\d+\.\d+/.test(first)) return false
  if (first.includes(':') && /^\S+:\d+$/.test(first)) {
    return false
  }
  return true
}

/**
 * Нормалізує шлях репозиторію (без тега/digest) для порівняння: `library/node`, `oven/bun`, …
 *
 * @param {string} imageToken — ref образу
 * @returns {string} нормалізований шлях репозиторію без тега
 */
export function normalizeHubRepoPath(imageToken) {
  let s = (imageToken.split('@')[0] || '').toLowerCase()
  s = s.replace(/^(docker\.io|index\.docker\.io)\//, '')
  if (!s.includes('/')) {
    return `library/${s.split(':')[0]}`
  }
  const lastSl = s.lastIndexOf('/')
  const lastCol = s.lastIndexOf(':')
  if (lastCol > lastSl) {
    s = s.slice(0, lastCol)
  }
  return s
}

const HUB_REPOS_REQUIRING_MIRROR = /** @type {const} */ ([
  'oven/bun',
  'library/alpine',
  'library/nginx',
  'library/node'
])

const EXPECTED_MIRROR = /** @type {const} */ ({
  'oven/bun': 'mirror.gcr.io/oven/bun',
  'library/alpine': 'mirror.gcr.io/library/alpine',
  'library/nginx': 'mirror.gcr.io/library/nginx',
  'library/node': 'mirror.gcr.io/library/node'
})

/**
 * Якщо образ тягнеть з Hub і підлягає дзеркалу — повертає рекомендовану заміну, інакше `null`.
 *
 * @param {string} imageToken — ref після `FROM`
 * @returns {string | null} рекомендований `mirror.gcr.io/...` (без тега) або null
 */
export function getRequiredMirrorGcrImage(imageToken) {
  if (!imageToken) return null
  if (/^mirror\.gcr\.io\//i.test(imageToken)) return null
  if (!isDockerHubStyleImageRef(imageToken)) return null
  const norm = normalizeHubRepoPath(imageToken)
  if (!HUB_REPOS_REQUIRING_MIRROR.includes(/** @type {any} */ (norm))) {
    return null
  }
  return EXPECTED_MIRROR[/** @type {keyof typeof EXPECTED_MIRROR} */ (norm)]
}

/**
 * Сканує вміст Dockerfile / Containerfile — повертає рядок помилки або `null`.
 *
 * @param {string} fileContent — повний вміст Dockerfile
 * @returns {string | null} повідомлення з номером рядка або null
 */
export function getMirrorGcrHint(fileContent) {
  const lines = fileContent.split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    const image = getFromImageToken(line)
    const expected = getRequiredMirrorGcrImage(image)
    if (expected) {
      return `рядок ${n + 1}: FROM має тягнути ${expected} (замість ${image})`
    }
  }
  return null
}
