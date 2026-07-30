# `ci.policy@1` — slot для crosscutting CI-політик мовних екосистем

**Дата:** 2026-07-30
**Статус:** чернетка на погодження
**Зв'язані документи:** `docs/specs/2026-07-27-universal-plugin-slots-lang-php-extraction.md`
(рішення А–К, «Історія адаптацій» п.8–10), `npm/scripts/lib/plugin-slots.mjs`,
`npm/scripts/lib/slot-contracts-ci.mjs`,
`plugins/ci-github/rules/rust/toolchain_cache/**` (еталонний кейс)

## 1. Проблема

`ci.artifact@1` покриває **файл-орієнтовані** артефакти: один `targetPath`, template,
merge-семантика (`deep-subset`/`contains-step`). Аудит симетрії (сесія 2026-07-27) виявив
клас перевірок, який цей контракт принципово не покриває — **crosscutting-політики**: правила
про відношення кроків усередині кожного job-а **всіх** workflow-файлів, з умовами від стану
репозиторію.

Еталонний кейс — `plugins/ci-github/rules/rust/toolchain_cache/**` (визнаний виняток п.2
аудиту, лишений у ci-github):

- скоуп — **усі** `.github/workflows/*.yml`, а не один відомий шлях;
- семантика — «якщо job має крок `uses: dtolnay/rust-toolchain@…` → у **тому самому job-і
  пізніше** мусить бути `Swatinem/rust-cache@…`»;
- умовне уточнення від **стану репо поза workflow**: якщо job викликає
  `tauri-apps/tauri-action` і `Cargo.toml` лежить під `src-tauri/` (а не в корені) — кеш-крок
  мусить мати `with.workspaces: src-tauri`;
- детермінований T0-фікс вставляє крок **після** тригер-кроку, з урахуванням відступів;
- аналіз навмисно текстовий (не YAML-AST) — мінімальний diff, стійкість до коментарів.

Це Rust-знання у ci-github — та сама асиметрія, яку рішення Д/Е базової спеки прибрали для
lint-workflow-ів. Другий клас кандидатів уже існує: JS-екосистемні заборони у
`ga/workflow_common.rego` (`oven-sh/setup-bun`/`actions/cache`/`bun install` поза composite
`setup-bun-deps`, checkout-before-setup ordering) — сьогодні вони вшиті в generic `ga`-канон,
хоча є знанням екосистеми bun/JS. Майбутні: python/uv setup-політики.

## 2. Ухвалені рішення

| # | Питання | Рішення |
|---|---|---|
| А | Форма contribution | **Module resource** (`.mjs` від мовного плагіна), НЕ декларативний DSL. Прецедент уже канонічний: `taze.provider@1`, `coverage.provider@1`, `doc-files.extractor@1` — усі module-contributions, які завантажує споживач. Еталонний кейс вимагає repo-предикатів (`src-tauri/Cargo.toml`) і обчислюваних значень (`workspaceDir`) — DSL під це роздувся б у мову; module з вузьким контрактом — ні |
| Б | Хто виконує | Тільки consumer (CI-плагін): він імпортує policy-модуль через той самий безпечний resource-механізм slot bus (path containment уже в брокері). Discovery модулі не імпортує — інваріант рішення І базової спеки зберігається |
| В | Слот і версія | `ci.policy@1` — новий canonical slot; `PLUGIN_API_VERSION` не росте (нове поле не додається в manifest — рішення Г/Ж базової спеки) |
| Г | Скоуп v1 | Лише GitHub-consumer (`ci-github`). Azure-consumer додається, коли з'явиться перший azure-policy: contribution без активного consumer — silent no-op (рішення Ї), тож lang-плагіни можуть декларувати azure-політики заздалегідь, нічого не ламаючи |
| Д | Область сканування v1 | Текстовий пер-файловий скан workflow-файлів (`.github/workflows/*.yml{,aml}`) — та сама модель, що чинний `toolchain_cache` і `ga/workflows`. Consumer читає файли і викликає policy; policy файлову систему workflow-ів сам не обходить |
| Е | Fix-модель | Типізований fix-hook у контракті модуля (`fix(finding, content) → content`), виконуваний T0-fixer-ом consumer-а; `fixability: "config"` у generic-концерні (урок «Історії адаптацій» п.10 — інакше LLM-ladder мутує чужі файли). Policy без fix-hook-а — diagnostic-only |
| Є | Активація | Generic-концерн `ci_policy/enforce` у ci-github, `main.json` правила `ci_artifact`… НІ: окреме правило `ci_policy` з `auto: "завжди"` (урок п.8 «Історії адаптацій»: правило без `main.json` ніколи не активується). Без активних contributions — тихий no-op |
| Ж | Ідентичність/колізії | Domain collision key — `policyId` (аналог `artifactId`): дубль між плагінами → error з provenance обох, без silent override (рішення И базової спеки) |
| З | Міграція v1 | `toolchain_cache` переїжджає у `lang-rust` як перша contribution. JS-політики `workflow_common` НЕ чіпаються у v1 (вони переплетені з generic-каноном `ga`; виносити — окрема фаза після стабілізації контракту) |

## 3. Контракт `ci.policy@1`

### 3.1. Manifest contribution (lang-плагін)

```json
{
  "slot": "ci.policy",
  "version": 1,
  "id": "rust-toolchain-cache",
  "resource": "./slots/policies/github-toolchain-cache.mjs",
  "requires": { "capabilities": ["ci:github"] }
}
```

Envelope — стандартний (брокер уже валідує path containment, дублікати, capability-гейт).
`id` contribution-а = `policyId` (domain collision key).

### 3.2. Інтерфейс policy-модуля

Default export, форма валідується консюмером через `assertCiPolicy` (експорт з
`@7n/rules/plugin-api`, поряд із чинними assert-хелперами):

```js
/**
 * @typedef {object} CiPolicyFinding
 * @property {string} reason     стабільний reason id (напр. `missing-rust-cache`)
 * @property {string} message    людське повідомлення (українською, з посиланням на канон)
 * @property {number} line       0-based рядок тригера у файлі
 * @property {object} [data]     дані для fix-hook-а (напр. { workspaceDir })
 */

export default {
  /** Стабільний id — МУСИТЬ збігатися з contribution id (консюмер це перевіряє). */
  id: 'rust-toolchain-cache',

  /**
   * Repo-контекст, обчислюваний один раз на прогін (repo-предикати живуть тут,
   * НЕ в scan — scan лишається чистою функцією контенту).
   * @param {{ cwd: string }} ctx
   * @returns {object} довільний immutable контекст (напр. { workspaceDir: 'src-tauri' })
   */
  prepare(ctx) {},

  /**
   * Чистий скан одного workflow-файла.
   * @param {string} content  вміст файла
   * @param {object} repoCtx  результат prepare()
   * @returns {CiPolicyFinding[]}
   */
  scan(content, repoCtx) {},

  /**
   * Опційний детермінований фікс ОДНОГО finding-а. Повертає новий вміст файла
   * або null (фікс неможливий → лишається diagnostic-only).
   * @param {string} content
   * @param {CiPolicyFinding} finding
   * @param {object} repoCtx
   * @returns {string | null}
   */
  fix(content, finding, repoCtx) {}
}
```

Обмеження контракту (перевіряються тестами конформності, як для `EcosystemProvider`):

- `scan` — чиста функція `(content, repoCtx)`: без fs/network/env; усі repo-залежності
  тільки через `prepare` (це робить scan тривіально тестовним і детермінованим);
- `fix` — чиста трансформація тексту; жодного запису на диск (пише consumer);
- модуль не отримує slot graph і не може продукувати нові contributions (рішення І).

### 3.3. Consumer (ci-github)

Нове правило `plugins/ci-github/rules/ci_policy/` (дзеркало структури `ci_artifact`):

- `main.json`: `{ "auto": "завжди" }` + `main.mdc` (канон slot-типу);
- концерн `enforce/`: `concern.json` (`fixability: "config"`, `lint.scope: "full"`,
  glob `.github/workflows/*.yml{,aml}`), `main.mjs`, `fix-enforce.mjs`;
- `main.mjs`: `getSlotContributions(graph, 'ci.policy', [1])` → фільтр
  `targetCapability`-ю через `requires.capabilities` (уже зроблено брокером) → для кожної
  policy: import модуля (той самий шлях, що `loadSlotConsumer`-семантика — динамічний import
  лише тут), `assertCiPolicy`, `prepare(ctx)` раз, `scan(content, repoCtx)` по кожному
  workflow-файлу; findings → violations із `policyId` і contributor-плагіном у diagnostics;
- `fix-enforce.mjs` (T0): для findings політик із `fix`-hook-ом — послідовне застосування
  до вмісту файла, ідемпотентність гарантується повторним `scan`-ом після фіксу;
- колізія `policyId` між плагінами → обидві виключаються + violation з provenance
  (точна копія логіки `artifact-id-collision`);
- зламаний policy-модуль (import/assert fail) → violation `policy-load-failed` з іменем
  плагіна; інші політики не зупиняються (fail-isolation, як §9.7 базової спеки).

Azure-consumer у v1 не створюється (рішення Г) — контракт `prepare/scan/fix` для
azure-pipelines.yml ідентичний за формою, тож додавання не потребує змін слота.

## 4. Міграція `toolchain_cache` (v1 vertical slice)

1. `plugins/lang-rust/slots/policies/github-toolchain-cache.mjs` — перенесення логіки
   `main.mjs` чинного правила у форму контракту: `tauriWorkspaceDir` → `prepare`;
   `scanToolchainSteps`+reporter-цикл → `scan` (два reason id: `missing-rust-cache`,
   `missing-rust-cache-workspaces`); `fix-toolchain_cache.mjs` → `fix` (вставка кроку
   після тригера / додавання `with.workspaces`). Reason ids, тексти повідомлень і
   поведінка — байт-у-байт (parity, як §6.1 базової спеки).
2. Manifest lang-rust: contribution з §3.1; `files` уже містить `slots`.
3. Нове правило `ci_policy` у ci-github (див. §3.3).
4. `git rm -r plugins/ci-github/rules/rust/toolchain_cache` — після parity-тестів;
   каталог `rules/rust/` у ci-github зникає повністю (остання мовна тека).
5. Тести:
   - конформність контракту (`assertCiPolicy` на реальному модулі lang-rust);
   - parity: ті самі fixtures, що в чинних тестах toolchain_cache (missing cache,
     tauri без workspaces, чистий workflow) → ідентичні reason/message; T0-фікс →
     байт-очікуваний результат + idempotent re-scan;
   - enforce-generic: нуль contributions → no-op; колізія policyId; policy-load-failed;
   - zero-touch: repo без Cargo.toml (lang-rust неактивний) → нуль rust-діагностик.

## 5. Явно поза скоупом v1

- Винос JS-політик із `ga/workflow_common.rego` (заборони setup-bun/cache/install поза
  composite) — фаза 2 після стабілізації контракту: вони переплетені з generic-каноном
  `ga` і потребують окремого рішення про межу «канон репо vs знання екосистеми».
- Azure-consumer — за першим реальним azure-policy.
- Політики над не-workflow файлами (напр. dependabot.yml) — інший scope, окреме рішення.

## 6. Версії і реліз

- core `@7n/rules`: `assertCiPolicy` + типи в plugin-api — **patch** (адитивний експорт);
- `ci-github`: нове правило + видалення `rules/rust/**` — **minor** (Added+Removed;
  enforcement зберігається, бо lang-rust у rust-репо авто-активний — та сама логіка,
  що у хвилі симетрії);
- `lang-rust`: contribution — **patch** (лишається в лінії `^0.14`).
- Жодних змін ranges/peers: усе в межах чинних пінів.

## Відкриті питання

1. Чи виносити JS-політики `workflow_common` у lang-js фазою 2 — чи вважати
   `setup-bun-deps` каноном репозиторію (не екосистеми) і лишити в `ga` назавжди?
2. Чи потрібен `severity` у `CiPolicyFinding` (v1: усі findings — violations; чинний
   `toolchain_cache` warning-ів не має — пропонується відкласти до реальної потреби).
