---
type: JS Module
title: resolve-plugins.mjs
resource: npm/scripts/lib/resolve-plugins.mjs
docgen:
  crc: 2bac9b49
---

Резолв плагінів @7n/rules: визначає, які пакети-плагіни активні у проєкті, де їхні `rules/`-каталоги, які capabilities вони надають і які handlers надають.

Джерело правди — поле `plugins: string[]` у `.n-rules.json`; воно завжди перекриває автодетект, а явний порожній масив означає «плагіни вимкнено». Якщо поля немає, `detectPluginsFromRepo` шукає файлові сигнали: наявність yml у `.github/workflows/` дає `@7n/rules-ci-github`, файл `azure-pipelines.yml` у корені — `@7n/rules-ci-azure` (реєстр `KNOWN_CI_PLUGINS`). Лише коли файлових CI-сигналів немає, вмикається fallback за `repository.url` кореневого package.json (`github.com` → github, `dev.azure.com`/`visualstudio.com` → azure). Обидва сигнали дають обидва плагіни, жодного — порожній список. Окремо від CI детектяться мовні плагіни (реєстр `KNOWN_LANG_PLUGINS`, лише файлові сигнали, без URL-fallback): кореневий `pyproject.toml` → `@7n/rules-lang-python`.

`ensurePluginInstalled` ставить відсутній плагін через `bun add -d` (пакет стає devDependency — зміна видима у diff). Будь-який фейл установки (offline, пакет не опублікований) — warning і graceful skip, ніколи не hard-fail: лінт і синк мають працювати без мережі.

`resolvePlugins(projectRoot, config, options)` — головна функція: повертає масив `{name, packageRoot, rulesDir, manifest}` доступних плагінів з кешем на процес. `options.allowInstall: false` — hot-path режим (hook, lint): лише вже встановлені пакети, без `bun add`; `options.quiet: true` глушить warning-и (hook викликається на кожен файл). Плагін, що декларує правила (`contributes.rules !== false`), але не має каталогу `rules/`, пропускається як битий; плагін із явним `contributes.rules: false` (лише handlers, як `lang-*`) — легальний, `resolveRulesDirs` його просто не включає у джерела правил.

Маніфест — блок `"n-rules"` у package.json плагіна: `capabilities` (масив рядків на кшталт `ci:github`, живлять гейт концернів `requires.capability`) і `contributes.handlers` (мапа extension-point → відносний шлях модуля). `getActiveCapabilities` агрегує capabilities усіх плагінів у Set; `getHandlers(point)` повертає абсолютні шляхи модулів-обробників (перший реальний споживач — taze-оркестратор, extension-point `taze`). `resolveRulesDirs` віддає впорядковані джерела правил: ядро завжди перше (його правила й концерни виграють колізії), далі плагіни у порядку списку. `clearPluginResolveCache` скидає кеш (для тестів).
