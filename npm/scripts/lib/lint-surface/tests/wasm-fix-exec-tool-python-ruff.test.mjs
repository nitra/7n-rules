/**
 * exec-tool fix-клас — ПЕРШИЙ портований концерн (`python/ruff`, реєстр
 * §2.63, поправка §2.51). На відміну від УСІХ інших wasm fix-тестів
 * (`wasm-fix-e2e.test.mjs`, `wasm-plugin-parity*.test.mjs::runWasmConcernFix`)
 * гість тут НЕ будує `FixPlan::edits` у пам'яті — `fix_ruff`
 * (`crates/plugin-lang-python/src/lib.rs`) спавнить `uv run --frozen ruff
 * check --fix .` + `ruff format .`, які САМІ мутують файли на диску, і
 * повертає ПОРОЖНІЙ план. Синтез `edits` — робота хоста
 * (`diff_snapshot_edits`, `crates/rules-napi/src/lib.rs`): знімок диска
 * ДО/ПІСЛЯ виклику `fix()`.
 *
 * Фейковий `uv` (не справжній `ruff`) робить перший describe-блок
 * детермінованим і незалежним від зовнішнього середовища — та сама техніка,
 * що `wasm-plugin-parity-python.test.mjs` (`toolPaths`/`PATH`-підміна на
 * спільний фейковий бінарник для JS-канону й wasm-гостя РАЗОМ). Другий
 * describe-блок ганяє СПРАВЖНІЙ `uv`/`ruff`, якщо вони є в середовищі —
 * якщо ні, тест чесно попереджає (`console.warn` + `describe.skip`), а не
 * тихо зеленіє (принцип «мовчазний skip — вада», feedback-нотатка сесії).
 *
 * Рівні покриття:
 * 1. `runWasmConcernFix` напряму (РЕАЛЬНИЙ napi-міст, не прямий виклик
 *    гостя — урок §2.47): план НЕ порожній і несе САМЕ змінений файл із
 *    вмістом, який реально опинився на диску після exec-tool-мутації.
 * 2. `runFixPipeline` (повний продакшн-конвеєр, `loadT0Patterns` резолвить
 *    і wasm-патерн, і JS-канон `fix-ruff.mjs` для того самого концерну):
 *    лічильник викликів фейкового `uv` доводить, що exec відбувається
 *    РІВНО двічі (`check --fix .` + `format .`) — JS-fallback НЕ
 *    перезапускає ті самі кроки поверх уже змінених файлів.
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { env } from 'node:process'

import { describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { runFixPipeline } from '../run-fix.mjs'
import { resetWasmConcernMapForTests } from '../wasm-plugins.mjs'
import { linkPackageRoot, realRepoRoot, withTmpDir, writeJson } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_python.wasm')
const BUILTIN_PINS_PATH = join(REPO_ROOT, 'npm', 'wasm-plugins', 'builtin-pins.json')
const hasBuiltinPins = existsSync(BUILTIN_PINS_PATH)

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-fix-exec-tool-python-ruff.test.mjs: wasm-компонент plugin-lang-python не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-python/build.sh'
  )
}

const RULE_ID = 'python'
const CONCERN_ID = 'ruff'
const CONCERN_KEY = `${RULE_ID}/${CONCERN_ID}`
const PY_REL = 'pkg/mod.py'
const PYPROJECT = '[project]\nname = "demo"\n'
const ORIGINAL_CONTENT = 'x=1\n'
const FIXED_CONTENT = 'x = 1\n'

/**
 * Записує виконуваний фейковий `uv`, що емулює `uv run --frozen ruff
 * check --fix .`/`ruff format .`/`ruff check <target>`/`ruff format --check
 * <target>` БЕЗ реального `ruff`: на `--fix`-кроці переписує `targetAbs`
 * заданим `fixedContent` і торкається `markerAbs` (сигнал «файл уже
 * пофіксовано»); на detect-кроках (`check`/`format --check` без `--fix`)
 * повертає код виходу за наявністю маркера — той самий кінцевий ефект, що
 * дав би ідемпотентний реальний `ruff` (чисто ПІСЛЯ фіксу, порушено ДО).
 * Кожен виклик (крім `--version`-проби) дописує рядок у `counterAbs` —
 * доказ кількості реальних спавнів для теста «без подвійного прогону».
 * @param {string} scriptAbs Абсолютний шлях майбутнього бінарника.
 * @param {{ targetAbs: string, fixedContent: string, markerAbs: string, counterAbs: string }} cfg Конфіг поведінки.
 * @returns {Promise<string>} `scriptAbs` (для прямого використання як `toolPaths.uv`/`PATH`-запису).
 */
async function writeFakeUv(scriptAbs, { targetAbs, fixedContent, markerAbs, counterAbs }) {
  const script = `#!/bin/sh
ARGS="$*"
case "$ARGS" in
  *--version*) exit 0 ;;
esac
echo 1 >> "${counterAbs}"
case "$ARGS" in
  *"check --fix ."*)
    printf '%s' '${fixedContent}' > "${targetAbs}"
    touch "${markerAbs}"
    exit 0
    ;;
  *"format ."*)
    exit 0
    ;;
  *"check "*)
    if [ -f "${markerAbs}" ]; then exit 0; else exit 1; fi
    ;;
  *"format --check "*)
    if [ -f "${markerAbs}" ]; then exit 0; else exit 1; fi
    ;;
esac
exit 0
`
  await writeFile(scriptAbs, script, 'utf8')
  await chmod(scriptAbs, 0o755)
  return scriptAbs
}

/** Сіє мінімальний rulesDir з РЕАЛЬНИМ `concern.json` `python/ruff` (glob `**\/*.py`, якір `pyproject.toml`, per-file). */
async function seedRuffConcern(dir) {
  const concernDir = join(dir, 'rules', RULE_ID, CONCERN_ID)
  await mkdir(concernDir, { recursive: true })
  await writeJson(join(concernDir, 'concern.json'), {
    lint: { scope: 'per-file', glob: ['**/*.py'], anchors: ['pyproject.toml'] }
  })
  await writeJson(join(dir, '.n-rules.json'), { rules: [RULE_ID] })
  return { rulesDir: join(dir, 'rules'), concernDir }
}

;(hasBuiltinPins ? describe : describe.skip)(
  'runWasmConcernFix — python/ruff (exec-tool клас, фейковий uv, РЕАЛЬНИЙ napi-міст)',
  () => {
    test('exec-tool мутує диск напряму → host-diff синтезує непорожній план із САМЕ зміненим файлом', async () => {
      await withTmpDir(async dir => {
        await writeFile(join(dir, 'pyproject.toml'), PYPROJECT, 'utf8')
        await mkdir(join(dir, 'pkg'), { recursive: true })
        const targetAbs = join(dir, PY_REL)
        await writeFile(targetAbs, ORIGINAL_CONTENT, 'utf8')

        const binDir = join(dir, 'fake-bin')
        await mkdir(binDir, { recursive: true })
        const counterAbs = join(dir, 'uv-calls.log')
        const markerAbs = join(dir, '.ruff-fixed-marker')
        const uvPath = await writeFakeUv(join(binDir, 'uv'), {
          targetAbs,
          fixedContent: FIXED_CONTENT,
          markerAbs,
          counterAbs
        })

        // Аггрегована діагностика — точний вигляд `detect_ruff` (§2.53,
        // `plain_violation` СТАВИТЬ `file: null` безумовно): concern
        // `per-file`, тож без `delta_files` napi впав би голосно
        // (`ambiguous_empty_fix_batch_err`).
        const violations = [
          { reason: 'ruff-check-violation', message: 'm', severity: 'error', file: null }
        ]

        // `delta_files` — той самий список, що продакшн-планувальник
        // (`plan_concern_for_delta`, `crates/rules-core/src/lint_plan.rs`)
        // будує для непорожньої дельти: цільові файли + якір
        // `pyproject.toml` (`concern.json.lint.anchors`) — без нього
        // `prepare_python_run` бачить батч БЕЗ `pyproject.toml` і мовчки
        // виходить у `Skip` (той самий preflight, що й `detect_ruff`).
        const plan = loadNative().runWasmConcernFix(
          WASM_PATH,
          CONCERN_KEY,
          dir,
          violations,
          { uv: uvPath },
          [PY_REL, 'pyproject.toml']
        )

        // РЕД ДО ФІКСУ (доведено дією, PR-опис): та сама сцена перед
        // host-diff давала `plan.edits: []` — `fix_ruff` не диспетчеризувався
        // взагалі (`Guest::fix` заглушка), файл на диску НЕ мінявся.
        expect(plan.edits.length).toBeGreaterThan(0)
        const writeEdit = plan.edits.find(e => e.type === 'write' && e.path === PY_REL)
        expect(writeEdit).toBeDefined()
        expect(writeEdit.content).toBe(FIXED_CONTENT)

        // Синтезований edit відповідає РЕАЛЬНОМУ стану диска (exec-tool
        // писав напряму, host лише зняв різницю) — не вигаданий вміст.
        expect(await readFile(targetAbs, 'utf8')).toBe(FIXED_CONTENT)
      })
    })

    test('декларативний концерн (без exec-tool) — diff_snapshot_edits нічого не додає до власного плану гостя', async () => {
      await withTmpDir(async dir => {
        // `python/doc_comments` — декларативний фіксер (`fix_doc_comments`),
        // не мутує диск у `fix()`: регресія host-diff мала б лишити план
        // РІВНО тим, що повернув гість.
        const target = 'pkg/mod.py'
        await mkdir(join(dir, 'pkg'), { recursive: true })
        const original = '# опис функції\ndef run():\n    pass\n'
        await writeFile(join(dir, target), original, 'utf8')

        const violations = [
          {
            reason: 'promotable-comment',
            message: 'm',
            severity: 'error',
            file: target,
            data: { fromLine: 0, toLine: 0, headerEnd: 1, promotable: true }
          }
        ]
        const plan = loadNative().runWasmConcernFix(WASM_PATH, 'python/doc_comments', dir, violations, {})
        // Файл на диску НЕ торкнутий гостем (декларативний фікс працює над
        // вмістом у памʼяті) — host-diff бачить `before === after` для
        // кожного шляху свого знімку (`**/*.py`), синтезованих edits немає.
        expect(await readFile(join(dir, target), 'utf8')).toBe(original)
        for (const edit of plan.edits) {
          expect(edit.path).not.toBe('pyproject.toml')
        }
      })
    })
  }
)

;(hasBuiltinPins ? describe : describe.skip)(
  'runFixPipeline — python/ruff (exec-tool клас, фейковий uv, продакшн-конвеєр)',
  () => {
    test('T0 закриває concern wasm-фіксом; JS-fallback (fix-ruff.mjs) НЕ перезапускає ті самі кроки', async () => {
      await withTmpDir(async dir => {
        await linkPackageRoot(dir)
        const { rulesDir } = await seedRuffConcern(dir)
        await writeFile(join(dir, 'pyproject.toml'), PYPROJECT, 'utf8')
        await mkdir(join(dir, 'pkg'), { recursive: true })
        const targetAbs = join(dir, PY_REL)
        await writeFile(targetAbs, ORIGINAL_CONTENT, 'utf8')

        const binDir = join(dir, 'fake-bin')
        await mkdir(binDir, { recursive: true })
        const counterAbs = join(dir, 'uv-calls.log')
        const markerAbs = join(dir, '.ruff-fixed-marker')
        await writeFakeUv(join(binDir, 'uv'), {
          targetAbs,
          fixedContent: FIXED_CONTENT,
          markerAbs,
          counterAbs
        })

        // git-репо зі staged `.py`-файлом — JS-канон (`fix-ruff.mjs`) ганяє
        // `git ls-files -z -- *.py`, щоб знайти цілі: без цього кроку тест
        // «JS-fallback не перезапускається» був би зеленим ФАЛЬШИВО (не
        // тому, що guestFix зупинив фолбек, а тому, що фолбек мовчки не
        // знайшов би жодного файлу в НЕ-git tmp-каталозі й ніколи не спавнив
        // би `uv` узагалі — лічильник збігся б випадково).
        spawnSync('git', ['init', '-q'], { cwd: dir })
        spawnSync('git', ['add', '-A'], { cwd: dir })

        resetWasmConcernMapForTests()
        const originalPath = env.PATH
        let code
        try {
          // PATH-підміна — той самий мотив, що `wasm-plugin-parity-python.test.mjs`:
          // `ensure-tool`-контур ("path:uv" у plugin.toml) резолвить wasm-бік
          // toolPaths, `resolveCmd('uv')` (`fix-ruff.mjs` JS-канон, `resolve-cmd.mjs`)
          // резолвить JS-fallback — ОБИДВА мають побачити ТОЙ САМИЙ фейковий
          // бінарник, щоб лічильник викликів був вартий довіри.
          env.PATH = `${binDir}${delimiter}${originalPath ?? ''}`
          code = await runFixPipeline({
            rulesDir,
            cwd: dir,
            // `rules`+`files` (не `full: true`) — delta-режим планувальника
            // (`buildLintPlan`, `mode: 'scopedDelta'`) заповнює `item.files`
            // (ціль + якір `pyproject.toml`, доккомент [`seedRuffConcern`]).
            // `full: true` лишає `item.files` НЕВИЗНАЧЕНИМ для per-file
            // концернів (native `buildLintPlan`, `mode: 'full'`) — той самий
            // `files: None`, що `run_wasm_concern`/`run_wasm_concern_fix`
            // (`crates/rules-napi/src/lib.rs`) резолвлять у ПОРОЖНІЙ batch
            // для НЕ-`Full`-scope концерну (`python/ruff` — `per-file`):
            // preflight [`prepare_python_run`] бачить батч без
            // `pyproject.toml` і виходить у `Skip` — той самий гейт, що і
            // прямий napi-виклик вище без явної дельти. Не помилка
            // host-diff-інфраструктури цього кроку — існуюча межа
            // `per-file`-диспетчу в `full`-режимі, поза обсягом пілота.
            rules: [RULE_ID],
            files: [PY_REL],
            log: () => {
              /* no-op logger */
            },
            deps: {
              ladder: [],
              workerFor: () => () => {
                /* wasm T0 має закрити concern ДО ladder-а */
              }
            }
          })
        } finally {
          env.PATH = originalPath
        }

        expect(code).toBe(0)
        expect(await readFile(targetAbs, 'utf8')).toBe(FIXED_CONTENT)

        // Доказ «без подвійного прогону» — точний рахунок РЕАЛЬНИХ спавнів
        // фейкового `uv` (перевірено дією, PR-опис): 1 (canonical detect ДО
        // T0 — `ruff check` провалюється на першому кроці, `format --check`
        // НЕ спавниться — `detect_ruff` рано повертає) + 2 (T0 wasm-фікс —
        // `check --fix .` + `format .`, кешовано між `test()`/`apply()`,
        // доккомент `computeWasmFixPlan`) + 2 (canonical re-detect ПІСЛЯ
        // T0 — обидва кроки чисті, `afterT0.length === 0` закриває concern)
        // = 5. ДО host-diff (доведено дією нижче, stash обох Rust-правок)
        // T0-фаза `test()` бачила порожній план (`edits.length === 0`),
        // guestFix-пріоритет НЕ зупиняв цикл (`applyT0`, `run-fix.mjs`),
        // JS-fallback (`fix-ruff.mjs`, `standalone: true`) спавнив би ЩЕ ДВА
        // (`check --fix .` + `format .`) поверх уже змінених wasm-ом
        // файлів — і пайплайн усе одно не закривався б (`code !== 0`,
        // ladder порожній), бо wasm-план так і лишався б «нічого не
        // зробив» з погляду хоста.
        const calls = (await readFile(counterAbs, 'utf8')).trim().split('\n').filter(Boolean)
        expect(calls.length).toBe(5)

        // Прямий доказ відсутності double-apply: маркер-файл існує (гілка
        // `check --fix .` торкнулась його РІВНО один раз — лічильник вище
        // це вже підтвердив точним числом, тут — ще один незалежний
        // сигнал того самого факту).
        expect(existsSync(markerAbs)).toBe(true)
      })
    })
  }
)

// ---------------------------------------------------------------------
// Живий смок на СПРАВЖНЬОМУ `uv`/`ruff` — якщо їх немає в середовищі, тест
// ЧЕСНО повідомляє (console.warn) і пропускає ЛИШЕ цей describe-блок, а не
// тихо зеленіє (принцип «мовчазний skip — вада»).
// ---------------------------------------------------------------------
function realUvRuffAvailable() {
  const uvProbe = spawnSync('uv', ['--version'], { stdio: 'ignore' })
  if (uvProbe.error || uvProbe.status !== 0) return false
  const ruffProbe = spawnSync('uv', ['run', '--frozen', 'ruff', '--version'], {
    stdio: 'ignore',
    cwd: REPO_ROOT
  })
  return !ruffProbe.error && ruffProbe.status === 0
}

const hasRealUvRuff = hasBuiltinPins && realUvRuffAvailable()
if (hasBuiltinPins && !hasRealUvRuff) {
  console.warn(
    '⚠️ wasm-fix-exec-tool-python-ruff.test.mjs: живий смок на справжньому uv/ruff пропущено — ' +
      '`uv`/`ruff` недоступні в середовищі (потрібен `uv run --frozen ruff --version` у корені репо). ' +
      'Фейковий-uv describe-блоки вище й далі покривають host-diff-механіку.'
  )
}

;(hasRealUvRuff ? describe : describe.skip)(
  'runWasmConcernFix — python/ruff на СПРАВЖНЬОМУ uv/ruff (живий смок)',
  () => {
    test('справжній ruff --fix мутує файл на диску → host-diff бачить реальну зміну', async () => {
      await withTmpDir(async dir => {
        await writeFile(join(dir, 'pyproject.toml'), PYPROJECT, 'utf8')
        await mkdir(join(dir, 'pkg'), { recursive: true })
        const targetAbs = join(dir, PY_REL)
        // `ruff format` детермінує РІВНО такий стиль без будь-яких
        // `[tool.ruff]` налаштувань — дефолтний форматер прибирає пробіли
        // навколо `=` у присвоєнні на верхньому рівні, той самий case, що
        // фейковий-uv describe вище.
        await writeFile(targetAbs, ORIGINAL_CONTENT, 'utf8')

        const violations = [
          { reason: 'ruff-check-violation', message: 'm', severity: 'error', file: null }
        ]
        const plan = loadNative().runWasmConcernFix(WASM_PATH, CONCERN_KEY, dir, violations, {}, [
          PY_REL,
          'pyproject.toml'
        ])

        expect(plan.edits.length).toBeGreaterThan(0)
        const writeEdit = plan.edits.find(e => e.type === 'write' && e.path === PY_REL)
        expect(writeEdit).toBeDefined()
        const onDisk = await readFile(targetAbs, 'utf8')
        expect(onDisk).not.toBe(ORIGINAL_CONTENT)
        expect(writeEdit.content).toBe(onDisk)
      })
    })
  }
)
