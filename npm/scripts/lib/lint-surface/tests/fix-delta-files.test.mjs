/**
 * Проводка дельти запиту (`item.files`) у fix-контур wasm-плагінів —
 * рішення (б) відкритого питання, яке лишив PR #517 (доккомент
 * `crates/rules-contract/wit/world.wit` біля `record diagnostic`,
 * `crates/rules-napi/src/lib.rs::ambiguous_empty_fix_batch_err`).
 *
 * Rust-бік (`cargo test -p rules-napi`) доводить, що napi ЧЕСНО будує
 * `FixRequest::files` із `delta_files`. Цей файл закриває інший розрив —
 * host-проводку: чи доходить `item.files` від оркестрації до napi-виклику.
 * Без нього обидві половини були б зелені поодинці, а фіча не працювала б.
 *
 * Мокнуто рівно дві межі: `resolveWasmConcernMap` (щоб не залежати від
 * наявності локальної wasm-збірки — `builtin-pins.json` gitignored, у
 * чистому дереві мапа порожня) і `loadNative` (щоб ЗАПИСАТИ аргументи
 * виклику, а не виконати його). Сам `loadT0Patterns`/`wasmFixPattern` —
 * РЕАЛЬНІ: перевіряється продакшн-фабрика, не власна фікстура.
 */
import { describe, expect, test, vi } from 'vitest'

/** Ключ, свідомо відсутній серед реальних native-fix і wasm-контрибуцій. */
const CONCERN_KEY = 'scratch/delta_probe'

/** Записує аргументи `runWasmConcernFix` замість реального napi-виклику. */
const runWasmConcernFixMock = vi.fn(() => ({ edits: [] }))

vi.mock('../../native.mjs', () => ({
  loadNative: () => ({
    listNativeFixes: () => [],
    runWasmConcernFix: runWasmConcernFixMock,
  }),
}))

vi.mock('../wasm-plugins.mjs', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    resolveWasmConcernMap: async () =>
      new Map([[CONCERN_KEY, { wasmPath: '/fake/plugin.wasm', toolPaths: {} }]]),
  }
})

const { loadT0Patterns } = await import('../run-fix.mjs')

/**
 * Викликає `test()` продакшн-патерна й повертає аргументи, з якими він
 * пішов у napi.
 * @param {string[]|undefined} deltaFiles Дельта, передана в `loadT0Patterns`.
 * @returns {Promise<unknown[]>} Аргументи одного `runWasmConcernFix`.
 */
async function callArgsFor(deltaFiles) {
  runWasmConcernFixMock.mockClear()
  const [ruleId, concernId] = CONCERN_KEY.split('/')
  const patterns = await loadT0Patterns('/nonexistent-dir', concernId, ruleId, '/repo', deltaFiles)
  // Порожній масив зробив би перевірку нижче беззмістовною — падаємо тут.
  expect(patterns.length).toBe(1)
  patterns[0].test([{ reason: 'agg', message: 'без file' }])
  expect(runWasmConcernFixMock).toHaveBeenCalledTimes(1)
  return runWasmConcernFixMock.mock.calls[0]
}

describe('loadT0Patterns — дельта запиту доходить до runWasmConcernFix', () => {
  test('передана дельта стає шостим аргументом napi-виклику', async () => {
    const args = await callArgsFor(['src/a.py', 'src/b.py'])
    expect(args[5]).toEqual(['src/a.py', 'src/b.py'])
  })

  test('full-scope концерн (дельти немає) передає undefined, а не порожній масив', async () => {
    // Порожній масив тут був би ГІРШИМ за undefined: napi трактує
    // `Some(vec![])` як ту саму двозначність, що й відсутню дельту, і падає
    // (`ambiguous_empty_fix_batch_err`), тоді як `undefined` лишає йому
    // full-scope glob-обхід.
    const args = await callArgsFor(undefined)
    expect(args[5]).toBeUndefined()
  })
})
