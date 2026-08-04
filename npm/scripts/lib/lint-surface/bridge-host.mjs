/**
 * cspell:ignore NDJSON пайплайнити непортованим
 *
 * JS-бік ЗВОРОТНОГО МОСТУ (Р12 спеки `2026-07-30-rules-v2-rust-core-migration.md`):
 * тонкий виконавець залишку lint-поверхні, який запускає **Rust-CLI**
 * (`crates/rules-cli`), а не навпаки. Оркестрації тут немає за конструкцією —
 * план, сортування, рендер і exit-код рахує `rules-core`; цей модуль лише
 * відповідає на три вузькі запити, кожен з яких у Rust недосяжний:
 *
 * 1. `discover` — резолв плагінів (`resolveRulesDirs`/`getActiveCapabilities`,
 *    ~1200 рядків JS-автодетекту, блокер зрізу 3 фази 8) + ключі wasm-концернів;
 * 2. `applies` — виконання rule-level gate `<rule>/applies/main.mjs`
 *    (ВИКОНУВАНИЙ JS-модуль плагіна; у контракті плагінів v3 wasm-поверхні
 *    для `applies` немає);
 * 3. `detect` — виконання концернів, що мають `main.mjs`/policy-adapter
 *    (96 із 224 концернів репо на момент зрізу).
 *
 * # Один процес на прогін, не на концерн
 *
 * Спавн node коштує ~40 мс (вимірювання зрізу 4 фази 8, розділ 10.1
 * мінідизайну), тож міст — ДОВГОЖИВУЧИЙ процес: Rust піднімає його раз,
 * шле N запитів і закриває сокет наприкінці прогону. `detect` приймає БАТЧ
 * items (суцільний сегмент плану), а не один концерн.
 *
 * # Чому unix-сокет, а не stdin/stdout
 *
 * Концерни друкують у stdout (`text/cspell-fix`, `doc-files/docgen-*`) і
 * навіть спавнять тули з `stdio: 'inherit'` (`k8s/manifests`) — протокол на
 * stdout вони б корумпували. Сокет (`node:net` ⇄ `std::os::unix::net`) дає
 * окремий канал БЕЗ жодних fd-трюків, а stdout/stderr лишаються
 * успадкованими: вивід концернів іде користувачу дослівно так само, як під
 * чинним JS-CLI. Межа Unix-only збігається з платформною межею продукту
 * (Р1 спеки: darwin-arm64 + linux-x64).
 *
 * # Протокол
 *
 * NDJSON в обидва боки, строго request→response, по одному запиту за раз:
 * `{"id":N,"op":"...",...}` → `{"id":N,"ok":true,"result":{...}}` або
 * `{"id":N,"ok":false,"error":"..."}`. Перший запит — `hello`; відповідь
 * містить `protocol`, і Rust-бік fail-closed звіряє версію (той самий
 * enforcement-патерн, що `CONTRACT_VERSION` у napi-межі, Р10).
 *
 * Помилка ОДНОГО концерну не валить ні процес, ні решту батчу: item
 * повертається з полем `error` замість `violations`, а рішення «зупиняти
 * прогін чи ні» приймає Rust (дзеркало поділу відповідальності в
 * `rules_core::concerns::batch::run_concerns_batch`, де native-батч теж
 * fail-soft, а stop-at-first-error живе у викликача).
 */
import { createConnection } from 'node:net'
import { argv, env, exit } from 'node:process'
import { pathToFileURL } from 'node:url'

/**
 * Версія протоколу мосту; Rust-бік звіряє її fail-closed на `hello`.
 *
 * `2` — додано операцію `ensureTool` (команда `n-rules tools ensure`,
 * мінідизайн `docs/specs/2026-08-04-tools-ensure-design.md`): Rust-бік тепер
 * розраховує на її наявність, тож старий host мусить бути відкинутий на
 * handshake, а не отримати «невідома операція» посеред install-у.
 */
export const BRIDGE_PROTOCOL_VERSION = 2

/**
 * Один запит протоколу. Поля, крім `id`/`op`, специфічні для операції —
 * тому опційні: Rust шле рівно те, що потрібно обраній `op`.
 * @typedef {object} BridgeRequest
 * @property {number} id ідентифікатор запиту (повертається у відповіді)
 * @property {string} op ім'я операції
 * @property {string} [cwd] абсолютний корінь consumer-репо
 * @property {string} [rulesDir] override базового rules-каталогу (`discover`)
 * @property {{ ruleId: string, appliesPath: string }[]} [rules] правила з наявним gate-ом (`applies`)
 * @property {boolean} [verbose] докладний режим (`detect`)
 * @property {{ key: string, ruleId: string, concernId: string, dir: string, files: string[]|null }[]} [items] батч плану (`detect`)
 */

/**
 * `discover` — усе, що Rust не може порахувати сам: rules-каталоги після
 * резолву плагінів, активні capabilities і ключі wasm-концернів.
 *
 * `wasmConcernKeys` потрібні НЕ для виконання (wasm виконує host у Rust), а
 * для чесного гейта: якщо план зачепив wasm-концерн, native-шлях цього зрізу
 * віддає команду назад у JS-CLI замість мовчазної розбіжності.
 * @param {BridgeRequest} req запит (корінь репо + опційний базовий rules-каталог).
 * @returns {Promise<{ rulesDirs: string[], capabilities: string[], wasmConcernKeys: string[] }>} дані резолву.
 */
async function opDiscover(req) {
  const { readNRulesConfigLite } = await import('../read-n-rules-config-lite.mjs')
  const { getActiveCapabilities, resolveRulesDirs } = await import('../plugin-slots.mjs')
  const { DEFAULT_RULES_DIR } = await import('./run-detectors.mjs')
  const cwd = String(req.cwd)
  const config = await readNRulesConfigLite(cwd)
  const base = req.rulesDir ?? DEFAULT_RULES_DIR
  // `allowInstall: false, quiet: true` — той самий hot-path-режим, що в
  // `effectiveRulesDirs`/`filterByCapabilities` (`run-detectors.mjs`).
  const dirs = resolveRulesDirs(cwd, { plugins: config.plugins }, base, { allowInstall: false, quiet: true })
  const caps = getActiveCapabilities(cwd, { plugins: config.plugins }, { allowInstall: false, quiet: true })
  return {
    rulesDirs: dirs.map(d => d.rulesDir),
    capabilities: caps.values().toArray(),
    wasmConcernKeys: await wasmConcernKeys(cwd)
  }
}

/**
 * Ключі wasm-концернів або порожній список. Резолв wasm-мапи вже сам ковтає
 * збої окремих плагінів із `console.warn`; повна відмова резолву тут означає
 * «wasm-контрибуцій немає» — той самий ефект, що порожня мапа в `detect.mjs`.
 * @param {string} cwd абсолютний корінь consumer-репо.
 * @returns {Promise<string[]>} ключі `ruleId/concernId` wasm-контрибуцій.
 */
async function wasmConcernKeys(cwd) {
  try {
    const { resolveWasmConcernMap } = await import('./wasm-plugins.mjs')
    const map = await resolveWasmConcernMap(cwd)
    return map.keys().toArray()
  } catch {
    return []
  }
}

/**
 * `applies` — вердикт rule-level gate для кожного переданого правила.
 * Дзеркало `filterByRuleApplies` (`run-detectors.mjs`) з однією відмінністю:
 * помилка gate-а не кидається тут, а повертається полем `error` — рішення
 * приймає Rust (той самий поділ, що для `detect`).
 * @param {BridgeRequest} req правила з наявним `applies/main.mjs`.
 * @returns {Promise<{ verdicts: Record<string, { applies?: boolean, error?: string }> }>} вердикти за rule-id.
 */
async function opApplies(req) {
  /** @type {Record<string, { applies?: boolean, error?: string }>} */
  const verdicts = {}
  for (const rule of req.rules ?? []) {
    try {
      // eslint-disable-next-line no-unsanitized/method
      const mod = await import(pathToFileURL(rule.appliesPath).href)
      const applies = mod.applies
      if (applies === undefined) {
        verdicts[rule.ruleId] = { applies: true }
        continue
      }
      if (typeof applies !== 'function') {
        verdicts[rule.ruleId] = { error: `rule ${rule.ruleId}: applies/main.mjs має експортувати applies(cwd)` }
        continue
      }
      verdicts[rule.ruleId] = { applies: Boolean(await applies(req.cwd)) }
    } catch (error) {
      verdicts[rule.ruleId] = {
        error: `rule ${rule.ruleId}: не вдалося завантажити applies gate: ${error.message}`
      }
    }
  }
  return { verdicts }
}

/**
 * `detect` — виконання батчу концернів через ту саму `runConcernDetector`,
 * що й чинний JS-оркестратор (жодної другої реалізації detect-семантики:
 * native-гілка, wasm-гілка, policy-adapter, `main.mjs`, fail-open
 * `ToolProvisionError` — усе всередині неї).
 *
 * Кожен item ізольований: виняток одного концерну стає його полем `error`
 * і НЕ зриває решту батчу. Текст помилки віддається як є — для `DetectorError`
 * це вже готовий рядок «detector ruleId/concernId: …», який Rust друкує
 * дослівно (`💥 …`), тож формат infra-повідомлення не роздвоюється.
 * @param {BridgeRequest} req батч плану.
 * @returns {Promise<{ items: { key: string, violations?: unknown[], diagnostics?: unknown[], error?: string }[] }>} результати по items.
 */
async function opDetect(req) {
  const { readConcernMeta } = await import('../concern-meta.mjs')
  const { runConcernDetector } = await import('./detect.mjs')
  /** @type {{ key: string, violations?: unknown[], diagnostics?: unknown[], error?: string }[]} */
  const out = []
  for (const item of req.items ?? []) {
    const concern = await readConcernMeta(item.dir, item.concernId)
    if (concern === null) {
      out.push({ key: item.key, error: `detector ${item.ruleId}/${item.concernId}: немає concern.json` })
      continue
    }
    const ctx = {
      cwd: req.cwd,
      ruleId: item.ruleId,
      concernId: item.concernId,
      // `null` з протоколу → `undefined` у ctx: whole-repo концерни розрізняють
      // «немає списку» від «явно порожній список» (доккомент `detect.mjs`).
      files: item.files ?? undefined,
      verbose: req.verbose === true
    }
    try {
      const result = await runConcernDetector(concern, ctx)
      out.push({ key: item.key, violations: result.violations, diagnostics: result.diagnostics ?? [] })
    } catch (error) {
      out.push({ key: item.key, error: error?.message ?? String(error) })
    }
  }
  return { items: out }
}

/**
 * `ensureTool` — добування зовнішнього CLI-тула для команди `n-rules tools
 * ensure` (мінідизайн `docs/specs/2026-08-04-tools-ensure-design.md`,
 * розділ 4). Rust робить нативно те, що в Rust дешеве (резолв PATH/кеш,
 * `brew`/`scoop`), і делегує сюди рівно ОДИН шлях — GitHub Release
 * (завантаження + розпакування + атомарна публікація в кеш): другої
 * реалізації того самого завантаження не заводиться, поки чинний
 * `ensureToolAsync` усе одно потрібен непортованим споживачам.
 *
 * Міжпроцесний лок бере САМЕ ця функція (всередині `ensureToolAsync`) —
 * Rust-бік під час делегації лока не тримає, інакше було б самоблокування.
 * @param {BridgeRequest & { toolId?: string }} req запит із `toolId`.
 * @returns {Promise<{ path: string }>} абсолютний шлях до готового бінарника.
 */
async function opEnsureTool(req) {
  const { ensureToolAsync } = await import('../ensure-tool.mjs')
  const toolId = String(req.toolId ?? '')
  if (toolId === '') throw new Error('ensureTool: не задано toolId')
  return { path: await ensureToolAsync(toolId) }
}

/**
 * Диспатч одного запиту протоколу.
 * @param {BridgeRequest} req розібраний запит.
 * @returns {Promise<unknown>} результат операції.
 */
async function dispatch(req) {
  switch (req.op) {
    case 'hello': {
      return { protocol: BRIDGE_PROTOCOL_VERSION }
    }
    case 'discover': {
      return await opDiscover(req)
    }
    case 'applies': {
      return await opApplies(req)
    }
    case 'detect': {
      return await opDetect(req)
    }
    case 'ensureTool': {
      return await opEnsureTool(req)
    }
    default: {
      throw new Error(`невідома операція мосту: ${req.op}`)
    }
  }
}

/**
 * Підключається до сокета Rust-боку і обслуговує NDJSON-запити до його
 * закриття.
 *
 * `for await` по сокету, а не `socket.on('data')`: обробка запиту сама
 * асинхронна, тож подієвий колбек вимагав би ручного ланцюжка промісів, щоб
 * не переплутати порядок відповідей. Async-ітерація дає ту саму
 * послідовність задарма — наступний chunk читається лише після `await`
 * поточного запиту.
 * @param {string} socketPath шлях unix-сокета, який слухає `rules-cli`.
 * @returns {Promise<void>} завершується, коли сокет закрито.
 */
export async function serveBridge(socketPath) {
  const socket = createConnection(socketPath)
  let buffer = ''
  for await (const chunk of socket) {
    buffer += chunk.toString('utf8')
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.length > 0) {
        const req = JSON.parse(line)
        let payload
        try {
          payload = { id: req.id, ok: true, result: await dispatch(req) }
        } catch (error) {
          payload = { id: req.id, ok: false, error: error?.message ?? String(error) }
        }
        socket.write(`${JSON.stringify(payload)}\n`)
      }
      nl = buffer.indexOf('\n')
    }
  }
}

/** Точка входу: шлях сокета приходить аргументом або через `N_RULES_BRIDGE_SOCKET`. */
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  const socketPath = argv[2] ?? env.N_RULES_BRIDGE_SOCKET
  if (socketPath === undefined || socketPath.length === 0) {
    console.error('❌ bridge-host: не задано шлях сокета (аргумент або N_RULES_BRIDGE_SOCKET)')
    exit(1)
  }
  // ADR Stop-hooks мають пропускати внутрішні прогони як технічний шум — той
  // самий прапорець, що виставляє JS-роутер перед підкомандами-оркестраторами.
  env.ADR_HOOKS_SKIP = '1'
  await serveBridge(socketPath)
  // Явний `exit` — концерн міг лишити «висіти» таймер чи дескриптор
  // (типово: не закритий watcher зовнішнього тула), і без цього процес
  // пережив би закритий сокет, а Rust-бік чекав би на нього у `Drop`.
  exit(0)
}
