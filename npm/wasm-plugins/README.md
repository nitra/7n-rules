# npm/wasm-plugins/

Тека вбудованих пінів first-party wasm-плагінів (`@7n/rules`, задача O1 фази
6 v2, рішення Н спеки
[`docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`](../../docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md)
§3.4). Тут при релізі опиняються:

- `<package-name>.wasm` — зібрані Component Model компоненти first-party
  плагінів (сьогодні один — `plugin-lang-js.wasm`, `crates/plugin-lang-js`);
- `builtin-pins.json` — таблиця `{ "<name>": { "file": "<basename>.wasm",
  "sha256": "<64 hex>" } }`, яку `npm/scripts/lib/lint-surface/wasm-plugins.mjs`
  (`readBuiltinPinsConfig`) читає ПОРЯД із собою (шлях від `import.meta.url`)
  — найнижче пріоритетне джерело записів `wasmPlugins`, перекривається
  записом `.n-rules.json` консюмера з тим самим `name`.

**Жоден з цих двох артефактів НЕ комітиться в git** (`.gitignore`) — генеруються:

- локально: `node npm/scripts/build-wasm-plugins.mjs` (dev-петля, спавнить
  `build.sh` кожного крейта з `FIRST_PARTY_WASM_PLUGINS`, копіює артефакт
  сюди, рахує sha256, пише `builtin-pins.json`);
- у CI: той самий скрипт, крок `build-native` у `.github/workflows/npm-publish.yml`
  (ubuntu-рядок — wasm-компонент платформо-незалежний), артефакт
  завантажується назад у `release-publish` перед `npm publish npm/package.json`.

Без локальної збірки тека містить лише цей `README.md` — це очікуваний стан
(«repo-дерево без wasm-збірки»), не помилка: `wasm-plugins.mjs` і тести, що
залежать від builtin-таблиці, мовчки/`skip` це враховують.
