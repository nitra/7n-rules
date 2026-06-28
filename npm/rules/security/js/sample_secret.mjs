/** @see ./docs/sample_secret.md */
import { readFile } from 'node:fs/promises'
import { relative, sep } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/** Суфікс basename'а прикладного файлу (`config.example`, `.env.dist`). */
const EXAMPLE_SUFFIX_RE = /\.(?:example|sample|template|dist)$/iu

/** Infix у basename'і (`docker-compose.example.yml`, `app.config.sample.json`). */
const EXAMPLE_INFIX_RE = /\.(?:example|sample|template)\./iu

/** Сегмент шляху з фікстурами (`fixtures/`, `fixture/`, `__fixtures__/`). */
const FIXTURE_DIR_RE = /(?:^|\/)(?:__fixtures__|fixtures?)(?:\/|$)/u

/**
 * Bare-`secret` у позиції значення: після `=`, `:` або `=>` (опційні лапки), а
 * далі лише пробіли / завершальна пунктуація / коментар до кінця рядка. Прив'язка
 * до `$` гарантує, що `secret` — увесь токен значення (`secret-key`, `secretValue`
 * не матчаться); прив'язка до `[:=]` відсікає імена ключів (`client_secret`).
 * Без урахування регістру символів.
 */
const VALUE_SECRET_RE = /[:=]>?\s*(['"]?)secret\1[\s,;}\])]*(?:(?:#|\/\/).*)?$/iu

/**
 * Чи є файл «прикладним» — таким, де `secret` очікувано є placeholder'ом.
 * @param {string} relPosix відносний шлях від cwd у posix-форматі
 * @returns {boolean} `true`, якщо файл треба сканувати
 */
function isExampleFile(relPosix) {
  const base = relPosix.slice(relPosix.lastIndexOf('/') + 1)
  return EXAMPLE_SUFFIX_RE.test(base) || EXAMPLE_INFIX_RE.test(base) || FIXTURE_DIR_RE.test(relPosix)
}

/**
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} exit-код перевірки (0 — OK, 1 — є bare `secret`)
 */
export async function main(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  /** @type {Array<{ abs: string, rel: string }>} */
  const examples = []
  await walkDir(cwd, abs => {
    const rel = relative(cwd, abs).split(sep).join('/')
    if (isExampleFile(rel)) examples.push({ abs, rel })
  })
  examples.sort((a, b) => a.rel.localeCompare(b.rel))

  if (examples.length === 0) {
    pass('прикладних файлів не знайдено — placeholder перевіряти нема де')
    return reporter.getExitCode()
  }

  let violations = 0
  for (const { abs, rel } of examples) {
    let content
    try {
      content = await readFile(abs, 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    for (const [i, line_] of lines.entries()) {
      const line = line_.endsWith('\r') ? line_.slice(0, -1) : line_
      if (!VALUE_SECRET_RE.test(line)) continue
      violations++
      fail(`${rel}:${i + 1}: \`${line.trim()}\` — заміни placeholder \`secret\` на \`sample-secret\` (security.mdc)`)
    }
  }

  if (violations === 0) {
    pass(`прикладні файли (${examples.length}) не містять bare \`secret\``)
  }
  return reporter.getExitCode()
}
