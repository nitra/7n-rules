# Маніфест wasm-плагіна `n-rules:plugin@3.0.0` (шаблон скіла `wasm-plugin`,
# npm/skills/wasm-plugin/SKILL.md) — статичний дублікат того, що `describe()`
# (src/lib.rs) повертає в рантаймі. Поля 1:1 відповідають
# `rules_contract::manifest::Manifest` (crates/rules-contract/src/manifest.rs,
# без serde-перейменувань — назви полів тотожні Rust-структурі). Хост читає
# цей файл лише як довідку для людини й дистрибуційний supplement — джерело
# правди в рантаймі завжди `describe()` (не парситься назад у `PluginHost`,
# спека §3.1).

id = "__PLUGIN_ID__"
version = "0.1.0"
world_version = "3.0.0"
domains = ["lint"]
# `ci_artifacts`/`tools` — top-level поля маніфеста, тож мусять стояти ПЕРЕД
# першим `[[concerns]]`: після array-of-tables заголовка TOML прочитав би їх
# як поля ОСТАННЬОГО концерну, а не як поля кореня (`[capabilities]` нижче
# від цього застережений — це власна таблиця, не голий ключ).
ci_artifacts = []
# Зовнішні tool-залежності (рішення Д спеки), напр. `["shellcheck@^0.9"]` —
# лишай порожнім, якщо концерн нічого не спавнить.
tools = []
# per-file — типовий дефолт (доккомент src/lib.rs::build_manifest); заміни
# scope на "full" і заповни glob, якщо концерн — whole-repo/крос-файлова
# перевірка.
[[concerns]]
key = "__CONCERN_ID__"
scope = "per-file"
glob = []

[capabilities]
# Типовий концерн лишає порожнім — хост передає вміст файлів inline у
# `detect-batch`/`fix-request`, плагін не читає диск сам (спека §3.2).
# Заповнюй лише repo-relative шляхами/глобами, які плагіну справді потрібно
# читати напряму поза переданим батчем.
fs_read = []
# `true` лише якщо плагін реально потребує мережі — за замовчуванням
# заборонено (рішення Е спеки), enforcement — хостом (`PluginHost`).
network = false
