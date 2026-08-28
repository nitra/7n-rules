/**
 * Характеризаційний гейт T0-патерну `js-run-jsconfig-create` (`fix-runtime.mjs`)
 * — фіксує РЕАЛЬНУ поведінку JS-канону ДО порту в гість
 * (`crates/plugin-lang-js`, `fix_js_run_runtime`). Концерн `js-run/runtime`
 * ніколи не мав файлу `tests/` для JS-фіксера (лише детектор мав окремі
 * `.test.mjs`, видалені разом з `main.mjs` при wasm-порті детекту) — цей
 * файл закриває прогалину ПЕРЕД портом, а не після (постановка задачі: порт
 * без попередньо збудованого гейта — порт наосліп).
 *
 * Джерело поведінки — сам `fix-runtime.mjs`:
 * - `test()` — substring-регекс `JSCONFIG_MISSING_RE` (БЕЗ якоря `^`, працює
 *   на будь-якому місці в `message`);
 * - `apply()` — АНХОРЕНИЙ `JSCONFIG_MISSING_WS_RE` (`^\[ws\] є каталог…`) —
 *   `message`, що містить підрядок, але НЕ починається з `[ws] `, у `apply()`
 *   мовчки ігнорується (edge case з постановки задачі). Ця асиметрія
 *   (test() ширший за apply()) — навмисна поведінка канону, не баг.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { patterns } from '../fix-runtime.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

const P = patterns[0]

/**
 * Створює `<dir>/<ws>/` — сам фіксер НЕ робить `mkdir` перед `writeFileSync`
 * (доккомент модуля пояснює чому це безпечно: violation узагалі не виникає,
 * доки `<ws>/src/` не існує на диску — реальний виклик завжди застає
 * workspace-каталог уже створеним).
 * @param {string} dir корінь tmp-дерева
 * @param {string} ws назва workspace-пакета
 * @returns {Promise<void>} завершується після створення каталогу
 */
async function mkWorkspaceDir(dir, ws) {
  await mkdir(join(dir, ws), { recursive: true })
}

/** Канонічний вміст jsconfig.json — те саме джерело, що читає фіксер. */
const CANONICAL_CONTENT =
  readFileSync(
    new URL('../../jsconfig/template/jsconfig.json.snippet.json', import.meta.url),
    'utf8'
  ).trimEnd() + '\n'

/**
 * Violation у формі, яку реально видає `js-run/runtime` для під-перевірки 1
 * (`checkWorkspacePackage`, `runtime/main.mjs`).
 * @param {string} ws назва workspace-пакета
 * @returns {{reason: string, message: string}} violation
 */
function jsconfigMissingViolation(ws) {
  return {
    reason: 'runtime',
    message: `[${ws}] є каталог src/, але немає jsconfig.json — додай канонічний файл з js-run.mdc (NodeNext, include: src/**/*).`
  }
}

describe('fix-runtime T0 — js-run-jsconfig-create', () => {
  test('id', () => {
    expect(P.id).toBe('js-run-jsconfig-create')
  })

  test('test(): true, якщо ХОЧ ОДНЕ violation містить підрядок "…jsconfig.json" (без якоря)', () => {
    expect(P.test([jsconfigMissingViolation('api')])).toBe(true)
    // Substring будь-де в message — без провідного `[ws] ` теж true (test() без анхора).
    expect(P.test([{ reason: 'runtime', message: 'десь тут є каталог src/, але немає jsconfig.json теж' }])).toBe(
      true
    )
  })

  test('test(): false — жодне violation не містить підрядка', () => {
    expect(P.test([{ reason: 'runtime', message: 'process.env.PORT: заміни на env' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })

  test('apply(): один workspace без jsconfig.json → створює канонічний файл, touchedFiles/message заповнені', async () => {
    await withTmpDir(async dir => {
      await mkWorkspaceDir(dir, 'api')
      const violations = [jsconfigMissingViolation('api')]
      const result = await P.apply(violations, { cwd: dir })
      const target = join(dir, 'api', 'jsconfig.json')
      expect(existsSync(target)).toBe(true)
      expect(readFileSync(target, 'utf8')).toBe(CANONICAL_CONTENT)
      expect(result.touchedFiles).toEqual([target])
      expect(result.message).toBe(`створено jsconfig.json: ${target}`)
    })
  })

  test('apply(): кілька workspace-ів одразу → створює jsconfig.json для КОЖНОГО, у порядку violations', async () => {
    await withTmpDir(async dir => {
      await mkWorkspaceDir(dir, 'api')
      await mkWorkspaceDir(dir, 'worker')
      const violations = [jsconfigMissingViolation('api'), jsconfigMissingViolation('worker')]
      const result = await P.apply(violations, { cwd: dir })
      const apiTarget = join(dir, 'api', 'jsconfig.json')
      const workerTarget = join(dir, 'worker', 'jsconfig.json')
      expect(existsSync(apiTarget)).toBe(true)
      expect(existsSync(workerTarget)).toBe(true)
      expect(result.touchedFiles).toEqual([apiTarget, workerTarget])
    })
  })

  test('apply(): jsconfig.json уже існує → НЕ перезаписує, файл не потрапляє в touchedFiles (ідемпотентність)', async () => {
    await withTmpDir(async dir => {
      const { mkdir, writeFile } = await import('node:fs/promises')
      await mkdir(join(dir, 'api'), { recursive: true })
      const target = join(dir, 'api', 'jsconfig.json')
      await writeFile(target, '{"custom":true}\n', 'utf8')

      const result = await P.apply([jsconfigMissingViolation('api')], { cwd: dir })
      expect(result.touchedFiles).toEqual([])
      expect(readFileSync(target, 'utf8')).toBe('{"custom":true}\n')
    })
  })

  test('apply(): мікс — один workspace уже має jsconfig.json, інший ні → торкається лише відсутнього', async () => {
    await withTmpDir(async dir => {
      const { writeFile } = await import('node:fs/promises')
      await mkWorkspaceDir(dir, 'api')
      await writeFile(join(dir, 'api', 'jsconfig.json'), '{"custom":true}\n', 'utf8')
      await mkWorkspaceDir(dir, 'worker')

      const violations = [jsconfigMissingViolation('api'), jsconfigMissingViolation('worker')]
      const result = await P.apply(violations, { cwd: dir })
      const workerTarget = join(dir, 'worker', 'jsconfig.json')
      expect(result.touchedFiles).toEqual([workerTarget])
      expect(readFileSync(join(dir, 'api', 'jsconfig.json'), 'utf8')).toBe('{"custom":true}\n')
    })
  })

  test('apply(): дублікат того самого workspace у violations → пишеться РІВНО ОДИН раз (existsSync-side-effect канону)', async () => {
    await withTmpDir(async dir => {
      await mkWorkspaceDir(dir, 'api')
      const violations = [jsconfigMissingViolation('api'), jsconfigMissingViolation('api')]
      const result = await P.apply(violations, { cwd: dir })
      const target = join(dir, 'api', 'jsconfig.json')
      // Перша ітерація пише файл; друга бачить його вже на диску (реальний
      // existsSync побічний ефект СИНХРОННОГО циклу) і пропускає — touchedFiles
      // містить шлях лише ОДИН раз, не двічі.
      expect(result.touchedFiles).toEqual([target])
    })
  })

  test('apply(): message, що містить підрядок, але НЕ починається з "[ws] " → мовчки ігнорується (edge case постановки)', async () => {
    await withTmpDir(async dir => {
      const violations = [{ reason: 'runtime', message: 'десь тут є каталог src/, але немає jsconfig.json теж' }]
      // test() для цього ж набору дав би true (substring-регекс) — але apply()
      // нічого не створює, бо анхорений regex не матчиться.
      expect(P.test(violations)).toBe(true)
      const result = await P.apply(violations, { cwd: dir })
      expect(result.touchedFiles).toEqual([])
      expect(result.message).toBeUndefined()
    })
  })

  test('apply(): порожній масив violations → нічого не робить, без помилки', async () => {
    await withTmpDir(async dir => {
      const result = await P.apply([], { cwd: dir })
      expect(result.touchedFiles).toEqual([])
    })
  })

  test('apply(): викликає ctx.recordWrite ПЕРЕД записом кожного файлу (rollback-контракт)', async () => {
    await withTmpDir(async dir => {
      await mkWorkspaceDir(dir, 'api')
      const recorded = []
      await P.apply([jsconfigMissingViolation('api')], { cwd: dir, recordWrite: p => recorded.push(p) })
      expect(recorded).toEqual([join(dir, 'api', 'jsconfig.json')])
    })
  })
})
