/**
 * Security-parity документація (spec `docs/specs/2026-07-30-mago-php-toolchain.md` §4):
 * `mago lint` замінює `phpcs --standard=Security`, але formal parity не підтверджена —
 * набір lint-правил mago інший за походженням (curated style/quality rules, не
 * taint-аналіз потоку даних). Цей тест ФІКСУЄ фактичну поведінку закріпленого піна mago
 * (`tool-pins.json`) на 4 класичних security-патернах як документацію покриття:
 * апгрейд піна — привід перезапустити тест і побачити явну зміну (діагностичне red,
 * не мовчазний регрес).
 *
 * Знято реальним прогоном `mago lint --reporting-format json` на кожній фікстурі
 * (`fixtures/security/*.php`) станом на mago 1.45.0:
 *
 * | Фікстура                | Патерн                          | Ловить? | Рівень/код                  |
 * | ------------------------ | -------------------------------- | ------- | ---------------------------- |
 * | eval_user_input.php      | `eval($_GET[...])`               | ТАК     | error / `no-eval`             |
 * | sql_injection.php        | SQL-конкатенація з `$_GET`       | НІ      | (лише `function-name`, help) |
 * | xss_echo.php             | `echo` без escape вводу         | НІ      | (лише `function-name`, help) |
 * | command_injection.php    | `shell_exec($_GET[...])`         | НІ      | (лише `function-name`, help) |
 *
 * Фікстури копіюються у `withTmpDir` разом із синтезованим `composer.json`, а не читаються
 * напряму зі свого сталого місця в репо — синтезований `composer.json` НЕ додається у
 * `tests/fixtures/`: `run-v8r` (text.mdc) валідує JSON-схему для будь-якого доданого в git
 * `composer.json` через мережевий fallback і конфліктує на «schema … already exists»,
 * той самий інваріант, що вже тримають `composer_manifest`-тести (`withTmpDir`, не fixture-файл).
 *
 * Реальний mago не мокається — `describe.skipIf(!hasMago)` пропускає файл, якщо бінарник
 * не резолвиться в PATH (патерн `k8s/hasura_configmap`/`hasConftest`).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

import { lint } from '../main.mjs'

const hasMago = Boolean(resolveCmd('mago'))

const FIXTURES_DIR = join(fileURLToPath(import.meta.url), '..', 'fixtures', 'security')

/**
 * Копіює одну security-фікстуру у tmp-каталог поряд із мінімальним `composer.json`
 * (щоб пройти gate `existsSync(composer.json)` у `lint()`) і запускає real `mago lint`.
 * @param {string} fixtureName ім'я файла у `fixtures/security/`
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат `lint()`
 */
async function lintSecurityFixture(fixtureName) {
  const content = await readFile(join(FIXTURES_DIR, fixtureName), 'utf8')
  let result
  await withTmpDir(async dir => {
    await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
    await writeFile(join(dir, fixtureName), content, 'utf8')
    result = await lint({ cwd: dir, ruleId: 'php', concernId: 'mago_lint', files: [fixtureName] })
  })
  return result
}

describe.skipIf(!hasMago)('php/mago_lint — security-фікстури (parity-документація)', () => {
  test('eval_user_input.php → ловить (mago-lint / no-eval, error-рівень)', { timeout: 30_000 }, async () => {
    const { violations } = await lintSecurityFixture('eval_user_input.php')
    expect(violations).toHaveLength(1)
    expect(violations[0].reason).toBe('mago-lint')
    expect(violations[0].message).toContain('no-eval')
  })

  test('sql_injection.php → НЕ ловить SQL injection (лише стиль, exit 0)', async () => {
    const { violations } = await lintSecurityFixture('sql_injection.php')
    expect(violations).toHaveLength(0)
  })

  test('xss_echo.php → НЕ ловить XSS (лише стиль, exit 0)', async () => {
    const { violations } = await lintSecurityFixture('xss_echo.php')
    expect(violations).toHaveLength(0)
  })

  test('command_injection.php → НЕ ловить command injection (лише стиль, exit 0)', async () => {
    const { violations } = await lintSecurityFixture('command_injection.php')
    expect(violations).toHaveLength(0)
  })
})
