//! Спільний двигун template-merge — єдине джерело істини семантики мержу
//! для ОБОХ колiй міграції JS → Rust.
//!
//! Винесено з `crates/plugin-ci-github/src/lib.rs` (реєстр відкритих питань
//! `docs/plans/2026-08-05-open-questions-register.md`, розділ §1 плану
//! `docs/plans/2026-08-29-js-rust-migration-completion-plan.md`). Це чистий
//! рефакторинг: жодного рядка семантики не змінено, крім заміни
//! `is_yaml: bool` на [`Format`] (доккомент нижче пояснює, навіщо).
//!
//! # Навіщо крейт, а не друга копія в `rules-core`
//!
//! Родина `vscode_*`/`zed_settings` розсипана по обох колiях: девʼять
//! концернів у ядрі (`npm/rules/**` → `crates/rules-core`), шість у плагінах
//! (`plugins/**` → wasm-гості). Дублювався б не стільки код, скільки
//! **семантика мержу** — [`identity_key`], [`contained_in`], порядок ключів,
//! поведінка на масивах обʼєктів. Розходження двох копій було б ТИХИМ:
//! обидві компілюються, обидві зелені на своїх тестах, а `.vscode/settings.json`
//! після ядрового й після плагінного концерну виходить різний. Один крейт
//! робить таке розходження неможливим за побудовою.
//!
//! Прецедент винесення — `crates/rules-rego-engine` (§2.66), але форма інша:
//! там `regorus` переїхав У ХОСТ (imported WIT resource), бо він великий і
//! дублювався в пʼятьох гостях (−41,8% розміру). Тут виносити в хост нема
//! чого — `jsonc-parser`/`saphyr` малі, чисто-Rust, без C-тулчейну, а бюджет
//! гостя після §2.55 — 10 MiB. Натомість T0-мерж іде на КОЖЕН файл, і гнати
//! повний текст документа через component-межу туди-назад було б витратами
//! на порожньому місці. Тому — звичайний статичний крейт в обидві колії.
//!
//! # Feature-гейт `jsonc` / `yaml`
//!
//! Заміряно перед винесенням: ядрова частина родини — **виключно JSON/JSONC**
//! (`.vscode/extensions.json`, `.vscode/settings.json`, `.zed/settings.json`),
//! жодного YAML. Хірургічний YAML-мерж (`saphyr`, `MarkedYamlOwned`, spans,
//! flow-контейнери) потрібен ЛИШЕ гостям `ci-github`/`ci-azure` для
//! `.github/workflows/*.yml`. Тому:
//!
//! - `jsonc` (default) — [`Json`], [`is_subset`], [`merge_json_value`],
//!   JSONC-парс, [`MNode`], хірургія над JSON. Це бере `rules-core`.
//! - `yaml` — `saphyr`, [`parse_marked_document`], block-writer,
//!   flow-контейнери. Це додатково беруть гості.
//!
//! Ядро не платить за YAML нічим.
//!
//! # Чому [`Format`], а не `is_yaml: bool`
//!
//! Із bool-прапорцем виклик `try_surgical_merge(.., true)` у збірці без фічі
//! `yaml` мусив би десь тихо повернути `None` — тобто мовчазний skip, рівно
//! той клас дефекту, який ця міграція закриває. [`Format::Yaml`] існує ЛИШЕ
//! під `feature = "yaml"`, тож така збірка не компілюється взагалі: помилка
//! приходить від компілятора на місці виклику, а не даними в рантаймі.

/// Формат цільового документа — визначає і парсер, і writer хірургічного
/// шляху.
///
/// [`Format::Yaml`] СВІДОМО існує лише під `feature = "yaml"` (доккомент
/// модуля, розділ «Чому `Format`»): недосяжність YAML-гілки в jsonc-only
/// збірці — властивість системи типів, а не рантайм-перевірка.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Format {
    /// JSON із коментарями й trailing-комою — контракт, яким `.json`-файли
    /// читає сам VS Code (доккомент розділу «Справжня JSONC-підтримка»).
    Jsonc,
    /// YAML 1.2 (`saphyr`) — `.github/workflows/*.yml` та інші yml-таргети.
    #[cfg(feature = "yaml")]
    Yaml,
}

impl Format {
    /// Чи це YAML-таргет. У збірці без фічі `yaml` завжди `false` — варіанта
    /// [`Format::Yaml`] там просто не існує.
    pub fn is_yaml(self) -> bool {
        #[cfg(feature = "yaml")]
        {
            matches!(self, Format::Yaml)
        }
        #[cfg(not(feature = "yaml"))]
        {
            false
        }
    }
}

/// Escape рядка для вбудовування в JSON — той самий helper, що в
/// `crates/plugin-lang-rust`/`crates/plugin-lang-python` (крейти не діляться
/// кодом через wasm-межу, окрема копія).
pub fn json_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Мінімальне self-describing dynamic-значення YAML/JSON-документа — спільне
/// представлення і для конвертації в JSON-текст regorus `input`/`data`
/// ([`json_to_string`]), і для JS-паритетної логіки цього концерну
/// (`checkApplyWorkflow`/`verifyWorkflowEventPathsGlobsExist`), яка в каноні
/// індексує вже розпарсений YAML-обʼєкт (`yaml` npm-пакет). Один AST замість
/// двох (текст + типізований доступ) — [`saphyr`] дає власний `YamlOwned`,
/// цей enum лише звужує його до JSON-сумісної підмножини.
#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Array(Vec<Json>),
    /// Порядок вставки збережено (як і `saphyr`'s `MappingOwned` —
    /// `LinkedHashMap`) — не для коректності Rego (обʼєкти незалежні від
    /// порядку ключів), а для детермінованого JSON-тексту.
    Object(Vec<(String, Json)>),
}

impl Json {
    /// Доступ до поля обʼєкта за ключем — точний відповідник `getObjKey`
    /// (`main.mjs`): `None`, якщо `self` не обʼєкт чи ключа немає.
    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(items) => Some(items.as_slice()),
            _ => None,
        }
    }
}

/// Конвертує вже розпарсений `saphyr`-AST у [`Json`] — рекурсивний спуск по
/// `Mapping`/`Sequence`/`Value`(скаляр). `Representation`/`Tagged`/`Alias`/
/// `BadValue` не очікувані в GH Actions workflow YAML після `early_parse`
/// (дефолт `saphyr`-лоадера — скаляри вже розв'язані у `Value`) —
/// трактуються як `Json::Null` (skip-not-crash, той самий дух, що решта
/// контракту).
#[cfg(feature = "yaml")]
pub fn yaml_owned_to_json(node: &saphyr::YamlOwned) -> Json {
    use saphyr::YamlOwned;
    match node {
        YamlOwned::Value(scalar) => scalar_owned_to_json(scalar),
        YamlOwned::Sequence(items) => Json::Array(items.iter().map(yaml_owned_to_json).collect()),
        YamlOwned::Mapping(map) => Json::Object(
            map.iter()
                .map(|(k, v)| (yaml_key_to_string(k), yaml_owned_to_json(v)))
                .collect(),
        ),
        _ => Json::Null,
    }
}

#[cfg(feature = "yaml")]
fn scalar_owned_to_json(scalar: &saphyr::ScalarOwned) -> Json {
    use saphyr::ScalarOwned;
    match scalar {
        ScalarOwned::Null => Json::Null,
        ScalarOwned::Boolean(b) => Json::Bool(*b),
        ScalarOwned::Integer(i) => Json::Int(*i),
        ScalarOwned::FloatingPoint(f) => Json::Float(f.into_inner()),
        ScalarOwned::String(s) => Json::Str(s.clone()),
    }
}

/// Ключ мапи як рядок — GH Actions workflow YAML завжди має рядкові ключі;
/// нестроковий ключ (не очікуваний у цьому домені) деградує у `Debug`-текст
/// замість паніки.
#[cfg(feature = "yaml")]
fn yaml_key_to_string(key: &saphyr::YamlOwned) -> String {
    key.as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("{key:?}"))
}

/// Точний відповідник `parseWorkflowYaml` (`gha-workflow.mjs`): парсить
/// цілий YAML-документ і повертає `Some` лише коли корінь — обʼєкт (мапа);
/// парс-помилка чи не-обʼєктний корінь (скаляр/масив) — `None`, той самий
/// подвійний fallback, що JS `try { parse(content) } catch { null }` +
/// `typeof root === 'object'`.
#[cfg(feature = "yaml")]
pub fn parse_yaml_document(content: &str) -> Option<Json> {
    use saphyr::{LoadableYamlNode, YamlOwned};
    let docs = YamlOwned::load_from_str(content).ok()?;
    let doc = docs.into_iter().next()?;
    match yaml_owned_to_json(&doc) {
        json @ Json::Object(_) => Some(json),
        _ => None,
    }
}

// =====================================================================
// Справжня JSONC-підтримка (коментарі, trailing-кома) — заміна floor-
// валідатора `is_strict_json`, що жив тут раніше (звіт задачі §2.58, друга
// поправка — «target 2 (JSONC comment-preserving support) НЕ реалізовано.
// Свідомо... floor — повна, коректна... реалізація; target 2 лишається
// нереалізованою метою» — ЦЯ секція її реалізує). [`parse_yaml_document`] —
// YAML 1.2-парсер, СВІДОМО толерантний (доккомент вище — той самий парсер
// обслуговує і `.yml`, і `.json`-таргети, бо JSON — валідний YAML 1.2). Але
// `.vscode/*.json` у продакшн-конвенції VS Code — часто JSONC
// (`//`/`/* */`-коментарі, іноді trailing-кома), а JSONC НЕ є валідним
// YAML 1.2: `//`-рядок читається як plain-скаляр і, залежно від контексту,
// ЗЛИВАЄТЬСЯ із сусіднім ключем у СТРУКТУРНО валідний, але СЕМАНТИЧНО
// хибний YAML-документ (підтверджено мінімальним репро поза цим модулем:
// `// коментар\n"key": true` парситься в ОДИН ключ
// `"// коментар \"key\""` зі значенням `true` — не помилка парсингу, тиха
// втрата `key`).
//
// Попередня задача (§2.58) закрила це floor-гейтом (`is_strict_json` —
// ручний RFC 8259-валідатор, що відхиляв БУДЬ-ЯКИЙ JSONC-вхід — файл просто
// не чіпався). Ця секція замінює floor на СПРАВЖНЄ рішення — крейт
// [`jsonc_parser`] (dprint, MIT, `Cargo.toml` пояснює вибір і бюджет):
// [`parse_jsonc_document`] (аналог [`parse_yaml_document`] — той самий
// подвійний fallback: помилка парсингу чи не-обʼєктний корінь → `None`) для
// НЕанотованого читання ([`detect_policy`]/[`fix_vscode_extensions`]), і
// [`parse_marked_jsonc_document`] (аналог [`parse_marked_document`] —
// байтові `Range` на кожному вузлі) для хірургічного шляху
// ([`try_surgical_merge`], доккомент розділу «Хірургічний comment-preserving
// merge» нижче за текстом файлу — той самий [`MNode`]/[`Edit`]-обхід, лише
// annotated-джерело тепер може бути І `saphyr::MarkedYamlOwned` (YAML), І
// `jsonc_parser::ast::Value` (JSON) — коментарі виживають структурно: вони
// НЕ входять у діапазон жодного вузла AST (окрема `CommentMap`, яку ми
// свідомо НЕ збираємо — `CollectOptions::default()` лишає
// `CommentCollectionStrategy::Off`, нам потрібні лише діапазони «живих»
// вузлів), тож недоторкані діапазони вихідного тексту (де коментарі й
// живуть) лишаються байт-у-байт як є — той самий мотив, що робить YAML-гілку
// comment-preserving.
//
// [`jsonc_parse_options`] СВІДОМО обмежує дефолтну (дуже permissive,
// JSON5-подібну) поведінку крейта до РІВНО контракту JSONC, яким його читає
// сам VS Code (`//`/`/* */`-коментарі й trailing-кома — і НІЧОГО понад це):
// `allow_loose_object_property_names`/`allow_single_quoted_strings`/
// `allow_hexadecimal_numbers`/`allow_unary_plus_numbers`/
// `allow_missing_commas` — усі `false`. Не «максимально толерантний
// парсер», а «точно JSONC» — той самий дух, що [`is_strict_json`] мав для
// строгого JSON (замінений цією секцією, не «розмитий»).
// =====================================================================

/// Чи `target_path` — `.json`-таргет (за розширенням) — обидва `.vscode/*.json`
/// концерни цього крейта, на відміну від `.github/workflows/*.yml` —
/// той самий бінарний розподіл, що `cfg.is_yaml` у [`TemplateFixCfg`],
/// лише для [`PolicyCfg`], де такого явного поля немає (три policy-концерни
/// на один спільний [`detect_policy`], доккомент там).
pub fn target_path_is_json(target_path: &str) -> bool {
    target_path.ends_with(".json")
}

/// Опції [`jsonc_parser`] — РІВНО контракт JSONC (доккомент розділу вище):
/// коментарі й trailing-кома дозволені, жоден інший JSON5-подібний виняток
/// (unquoted-ключі/одинарні лапки/hex-числа/unary `+`/пропущені коми) — ні.
fn jsonc_parse_options() -> jsonc_parser::ParseOptions {
    jsonc_parser::ParseOptions {
        allow_comments: true,
        allow_trailing_commas: true,
        allow_loose_object_property_names: false,
        allow_missing_commas: false,
        allow_single_quoted_strings: false,
        allow_hexadecimal_numbers: false,
        allow_unary_plus_numbers: false,
    }
}

/// Текст числового літерала JSONC → [`Json`] — ціле, якщо парситься як
/// `i64` (той самий пріоритет, що [`saphyr::ScalarOwned::Integer`] для
/// YAML-гілки), інакше `f64`; будь-який нерозпізнаний текст (не мало б
/// статись — [`jsonc_parser`] уже підтвердив, що це валідний число-токен
/// власної граматики) деградує в `Json::Null` замість паніки — той самий
/// skip-not-crash мотив, що [`yaml_owned_to_json`] для неочікуваних вузлів.
fn jsonc_number_to_json(raw: &str) -> Json {
    if raw.contains(['.', 'e', 'E']) {
        raw.parse::<f64>().map(Json::Float).unwrap_or(Json::Null)
    } else {
        raw.parse::<i64>()
            .map(Json::Int)
            .unwrap_or_else(|_| raw.parse::<f64>().map(Json::Float).unwrap_or(Json::Null))
    }
}

/// [`jsonc_parser::JsonValue`] (НЕанотоване дерево — без спанів) → [`Json`] —
/// точний відповідник [`yaml_owned_to_json`], лише джерело JSONC, не YAML.
fn jsonc_value_to_json(v: jsonc_parser::JsonValue) -> Json {
    use jsonc_parser::JsonValue as JV;
    match v {
        JV::Null => Json::Null,
        JV::Boolean(b) => Json::Bool(b),
        JV::Number(s) => jsonc_number_to_json(s),
        JV::String(s) => Json::Str(s.into_owned()),
        JV::Array(arr) => Json::Array(arr.into_iter().map(jsonc_value_to_json).collect()),
        JV::Object(obj) => {
            Json::Object(obj.into_iter().map(|(k, v)| (k.into_owned(), jsonc_value_to_json(v))).collect())
        }
    }
}

/// Точний відповідник [`parse_yaml_document`] для JSONC-таргетів: парсить
/// цілий документ за [`jsonc_parse_options`] і повертає `Some` лише коли
/// корінь — обʼєкт; помилка парсингу (побитий синтаксис, порожній вхід,
/// сміття після кореневого значення) чи не-обʼєктний корінь — `None`, той
/// самий подвійний fallback.
pub fn parse_jsonc_document(content: &str) -> Option<Json> {
    let value = jsonc_parser::parse_to_value(content, &jsonc_parse_options()).ok()??;
    match jsonc_value_to_json(value) {
        json @ Json::Object(_) => Some(json),
        _ => None,
    }
}

/// Диспетчер [`parse_yaml_document`]/[`parse_jsonc_document`] за типом
/// таргету — єдина точка, де [`fix_template_merge`]/[`fix_vscode_extensions`]/
/// [`detect_policy`] читають вміст файлу, щоб жоден з них не забув
/// врахувати JSONC-контракт для `.json`-таргетів.
pub fn parse_target_document(content: &str, format: Format) -> Option<Json> {
    match format {
        Format::Jsonc => parse_jsonc_document(content),
        #[cfg(feature = "yaml")]
        Format::Yaml => parse_yaml_document(content),
    }
}

/// Рядкове імʼя властивості обʼєкта JSONC AST (лапкове чи «слово» — останнє
/// [`jsonc_parse_options`] забороняє на вході, але тип
/// [`jsonc_parser::ast::ObjectPropName`] лишається двоваріантним у самому
/// крейті, тож matching — вичерпний) разом з його ВЛАСНИМ байтовим
/// діапазоном — точний відповідник [`marked_key_to_string`] для YAML-гілки,
/// потрібен [`surgical_merge_object`] для колонки відступу нового запису.
fn jsonc_prop_name(name: &jsonc_parser::ast::ObjectPropName) -> (String, (usize, usize)) {
    use jsonc_parser::ast::ObjectPropName as PropName;
    match name {
        PropName::String(lit) => (lit.value.clone().into_owned(), (lit.range.start, lit.range.end)),
        PropName::Word(lit) => (lit.value.to_string(), (lit.range.start, lit.range.end)),
    }
}

/// [`jsonc_parser::ast::Value`] (анотоване дерево — байтові `Range` на
/// кожному вузлі, доккомент розділу вище) → [`MNode`] — точний відповідник
/// [`build_mnode`] для YAML-гілки. На відміну від [`build_mnode`], НЕ
/// потребує `char_byte_table`-конвертації: `jsonc_parser::common::Range` уже
/// байтові офсети в вихідному `&str` (доккомент `jsonc-parser`-крейта —
/// сканер рахує байти, не символи, на відміну від `saphyr::Marker`).
fn jsonc_ast_value_to_mnode(v: &jsonc_parser::ast::Value) -> MNode {
    use jsonc_parser::ast::Value as JV;
    match v {
        JV::Object(obj) => MNode::Object(
            obj.properties
                .iter()
                .map(|p| {
                    let (name, key_span) = jsonc_prop_name(&p.name);
                    (name, key_span, jsonc_ast_value_to_mnode(&p.value))
                })
                .collect(),
            (obj.range.start, obj.range.end),
        ),
        JV::Array(arr) => MNode::Array(
            arr.elements.iter().map(jsonc_ast_value_to_mnode).collect(),
            (arr.range.start, arr.range.end),
        ),
        JV::StringLit(s) => MNode::Scalar(Json::Str(s.value.clone().into_owned()), (s.range.start, s.range.end)),
        JV::NumberLit(n) => MNode::Scalar(jsonc_number_to_json(n.value), (n.range.start, n.range.end)),
        JV::BooleanLit(b) => MNode::Scalar(Json::Bool(b.value), (b.range.start, b.range.end)),
        JV::NullKeyword(nk) => MNode::Scalar(Json::Null, (nk.range.start, nk.range.end)),
    }
}

/// Той самий подвійний fallback, що [`parse_marked_document`] (YAML-гілка),
/// лише джерело — [`jsonc_parser::parse_to_ast`] за [`jsonc_parse_options`]:
/// помилка парсингу чи не-обʼєктний корінь → `None`, інакше — annotated
/// [`MNode`]-дерево зі спанами.
fn parse_marked_jsonc_document(content: &str) -> Option<MNode> {
    use jsonc_parser::{parse_to_ast, CollectOptions};
    let result = parse_to_ast(content, &CollectOptions::default(), &jsonc_parse_options()).ok()?;
    let value = result.value?;
    match &value {
        jsonc_parser::ast::Value::Object(_) => Some(jsonc_ast_value_to_mnode(&value)),
        _ => None,
    }
}

/// Escape рядка для вбудовування в JSON — той самий helper, що
/// [`json_escape_string`] вище (`rust/toolchain_cache`), перевикористаний
/// тут для JSON-серіалізації [`Json`].
fn write_json(value: &Json, out: &mut String) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Int(i) => out.push_str(&i.to_string()),
        Json::Float(f) => {
            if f.is_finite() {
                out.push_str(&f.to_string());
            } else {
                // JSON не має NaN/Infinity — GH Actions workflow YAML ніколи
                // не містить такого скаляра; захисний фолбек, не досяжний
                // на практиці.
                out.push('0');
            }
        }
        Json::Str(s) => out.push_str(&json_escape_string(s)),
        Json::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        Json::Object(entries) => {
            out.push('{');
            for (i, (k, v)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&json_escape_string(k));
                out.push(':');
                write_json(v, out);
            }
            out.push('}');
        }
    }
}

pub fn json_to_string(value: &Json) -> String {
    let mut out = String::new();
    write_json(value, &mut out);
    out
}

// =====================================================================
// ТРЕТЯ хвиля — `Json` deep-subset/deep-merge (точний порт `checkSnippet`/
// `mergeJsonValue`/`containedIn`/`identityKey`, `npm/scripts/lib/template.mjs`
// і `npm/scripts/lib/fix/template-deep-merge.mjs`) + два нові серіалізатори
// (доккомент модуля, розділ «ТРЕТЯ хвиля»).
// =====================================================================

/// Deep subset-of перевірка — точний функціональний відповідник
/// `checkSnippet(actual, snippet, opts).length === 0` (`template.mjs`), БЕЗ
/// побудови повідомлень (порт тут використовує тексти з Rego-виводу
/// [`eval_deny_rule`] для видимих violation-ів; ЦЯ функція лише вирішує
/// «чи fix-writer вже задовольняє snippet», той самий контракт, що
/// `computeJsonNextText`/`computeYamlNextText` — булевий шорткат навколо
/// `checkSnippet(...).length === 0`). `actual: None` — той самий канал, що
/// JS `actual[k] === undefined` (ключа немає ЧИ `actual` не обʼєкт).
pub fn is_subset(actual: Option<&Json>, snippet: &Json) -> bool {
    match snippet {
        Json::Null => true,
        Json::Array(items) => match actual {
            Some(Json::Array(arr)) => items.iter().all(|needle| contained_in(arr, needle)),
            _ => false,
        },
        Json::Object(entries) => match actual {
            Some(Json::Object(_)) => entries
                .iter()
                .all(|(k, v)| is_subset(actual.and_then(|a| a.get(k)), v)),
            _ => false,
        },
        leaf => actual == Some(leaf),
    }
}

/// Чи `needle` структурно вже присутній у якомусь елементі `actual_array` —
/// точний відповідник `containedIn` (`template-deep-merge.mjs`).
fn contained_in(actual_array: &[Json], needle: &Json) -> bool {
    actual_array.iter().any(|a| is_subset(Some(a), needle))
}

/// Ключ ідентичності елемента масиву обʼєктів — точний відповідник
/// `identityKey` (`template-deep-merge.mjs`): `name`-поле, інакше
/// `uses`-поле БЕЗ версії (`actions/x@v6` → `uses:actions/x`).
fn identity_key(obj: &Json) -> Option<String> {
    let Json::Object(_) = obj else {
        return None;
    };
    if let Some(name) = obj.get("name").and_then(Json::as_str) {
        return Some(format!("name:{name}"));
    }
    if let Some(uses) = obj.get("uses").and_then(Json::as_str) {
        let base = uses.split('@').next().unwrap_or(uses);
        return Some(format!("uses:{base}"));
    }
    None
}

/// Індекс елемента `actual_array` з тим самим [`identity_key`], що й
/// `needle` — точний відповідник `findIdentityIndex`.
fn find_identity_index(actual_array: &[Json], needle: &Json) -> Option<usize> {
    let key = identity_key(needle)?;
    actual_array
        .iter()
        .position(|a| identity_key(a).as_deref() == Some(key.as_str()))
}

/// Рекурсивний deep-merge snippet у [`Json`] — точний відповідник
/// `mergeJsonValue` (`template-deep-merge.mjs`): масиви — union за
/// [`contained_in`]/[`find_identity_index`] (структурний збіг пропускається,
/// той самий `name`/`uses` оновлюється on-place, інакше — додається);
/// обʼєкти — рекурсія по ключах snippet-а (зайві поля `actual` незайманими);
/// листя — canonical-значення перезаписує.
pub fn merge_json_value(actual: Option<&Json>, snippet: &Json) -> Json {
    match snippet {
        Json::Array(items) => {
            let mut arr: Vec<Json> = match actual {
                Some(Json::Array(a)) => a.clone(),
                _ => Vec::new(),
            };
            for needle in items {
                if contained_in(&arr, needle) {
                    continue;
                }
                match find_identity_index(&arr, needle) {
                    Some(idx) => {
                        let merged = merge_json_value(Some(&arr[idx]), needle);
                        arr[idx] = merged;
                    }
                    None => arr.push(needle.clone()),
                }
            }
            Json::Array(arr)
        }
        Json::Object(entries) => {
            let mut obj: Vec<(String, Json)> = match actual {
                Some(Json::Object(o)) => o.clone(),
                _ => Vec::new(),
            };
            for (k, v) in entries {
                let child = obj.iter().find(|(kk, _)| kk == k).map(|(_, vv)| vv);
                let merged = merge_json_value(child, v);
                match obj.iter_mut().find(|(kk, _)| kk == k) {
                    Some(entry) => entry.1 = merged,
                    None => obj.push((k.clone(), merged)),
                }
            }
            Json::Object(obj)
        }
        leaf => leaf.clone(),
    }
}

/// Pretty JSON — точний відповідник `JSON.stringify(x, null, 2) + '\n'`
/// (2-пробільний відступ). Використовується лише для `.json`-таргетів
/// ([`fix_vscode_extensions`]/[`fix_template_merge`] з `is_yaml: false`) —
/// на відміну від [`write_json`]/[`json_to_string`] (компактний, лише для
/// regorus `input`/`data`).
fn write_json_pretty(value: &Json, indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    let pad_in = "  ".repeat(indent + 1);
    match value {
        Json::Array(items) if items.is_empty() => out.push_str("[]"),
        Json::Array(items) => {
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                out.push_str(&pad_in);
                write_json_pretty(item, indent + 1, out);
                if i + 1 < items.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&pad);
            out.push(']');
        }
        Json::Object(entries) if entries.is_empty() => out.push_str("{}"),
        Json::Object(entries) => {
            out.push_str("{\n");
            for (i, (k, v)) in entries.iter().enumerate() {
                out.push_str(&pad_in);
                out.push_str(&json_escape_string(k));
                out.push_str(": ");
                write_json_pretty(v, indent + 1, out);
                if i + 1 < entries.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            out.push_str(&pad);
            out.push('}');
        }
        scalar => write_json(scalar, out),
    }
}

pub fn json_to_pretty_string(value: &Json) -> String {
    let mut out = String::new();
    write_json_pretty(value, 0, &mut out);
    out.push('\n');
    out
}

/// Block-стиль YAML-серіалізатор [`Json`] — доккомент модуля, розділ «ТРЕТЯ
/// хвиля»: НЕ comment-preserving (регенерує з нуля, на відміну від JS-канону
/// `yaml`-пакета), рядкові скаляри ЗАВЖДИ у подвійних лапках ([`json_escape_string`],
/// валідний YAML double-quoted scalar — той самий escaping, що JSON), щоб
/// уникнути plain-scalar quoting-евристик (`: `, `#`, provisions GH Actions
/// `${{ }}`-виразів тощо) — гарантовано валідний YAML 1.2 ЦІНОЮ втрати
/// «природної» неквотованої форми канону. Корінь має бути [`Json::Object`]
/// (обидва наші YAML-таргети — мапи), інакше — panics (внутрішній інваріант
/// викличної сторони, не runtime-умова).
#[cfg(feature = "yaml")]
pub fn write_yaml_block(root: &Json) -> String {
    let Json::Object(entries) = root else {
        panic!("write_yaml_block: корінь має бути обʼєктом");
    };
    let mut out = String::new();
    write_yaml_object_entries(entries, 0, &mut out);
    out
}

#[cfg(feature = "yaml")]
fn write_yaml_object_entries(entries: &[(String, Json)], indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    for (k, v) in entries {
        out.push_str(&pad);
        out.push_str(&yaml_key(k));
        out.push(':');
        write_yaml_value_after_colon(v, indent, out);
    }
}

/// Пише значення після `key:` — inline скаляр/`{}`/`[]`, чи блок з нового
/// рядка для непорожніх обʼєктів/масивів. `indent` — рівень БАТЬКІВСЬКОГО
/// ключа (масиви — той самий рівень відступу, що ключ; обʼєкти — +1).
#[cfg(feature = "yaml")]
fn write_yaml_value_after_colon(v: &Json, indent: usize, out: &mut String) {
    match v {
        Json::Object(e) if e.is_empty() => out.push_str(" {}\n"),
        Json::Object(e) => {
            out.push('\n');
            write_yaml_object_entries(e, indent + 1, out);
        }
        Json::Array(items) if items.is_empty() => out.push_str(" []\n"),
        Json::Array(items) => {
            out.push('\n');
            write_yaml_array_items(items, indent, out);
        }
        scalar => {
            out.push(' ');
            out.push_str(&scalar_literal(scalar));
            out.push('\n');
        }
    }
}

#[cfg(feature = "yaml")]
fn write_yaml_array_items(items: &[Json], indent: usize, out: &mut String) {
    let pad = "  ".repeat(indent);
    for item in items {
        out.push_str(&pad);
        out.push_str("- ");
        match item {
            Json::Object(entries) if !entries.is_empty() => {
                // Перший ключ — на тому самому рядку, що `- `; решта — з
                // відступом на один рівень глибше (стандартна GH Actions
                // block-форма `- uses: …\n  with: …`).
                let (first, rest) = entries.split_first().expect("непорожній");
                out.push_str(&yaml_key(&first.0));
                out.push(':');
                write_yaml_value_after_colon(&first.1, indent + 1, out);
                write_yaml_object_entries(rest, indent + 1, out);
            }
            Json::Array(sub) if !sub.is_empty() => {
                out.push('\n');
                write_yaml_array_items(sub, indent + 1, out);
            }
            _ => {
                out.push_str(&scalar_literal(item));
                out.push('\n');
            }
        }
    }
}

/// Ключ мапи — YAML-ключі в цих snippet-ах завжди прості ідентифікатори
/// (`name`/`uses`/`on`/`jobs`/…) чи `[github-actions-workflow]`-подібні
/// VS-Code-специфічні рядки ([`ga/vscode_settings`]) — той самий
/// double-quote мотив, що [`scalar_literal`], щоб не вгадувати безпечність.
#[cfg(feature = "yaml")]
fn yaml_key(k: &str) -> String {
    json_escape_string(k)
}

/// **Перейменовано при винесенні у крейт** (було `yaml_scalar`): назва
/// брехала. Функція віддає JSON-літерал (рядки — завжди в лапках через
/// [`json_escape_string`], решта — [`write_json`]), який є валідним І в
/// JSON, І в YAML 1.2 (flow-скаляр). Саме тому вона потрібна ОБОМ
/// форматам і НЕ гейтована фічею `yaml` — хірургічна заміна листа
/// ([`surgical_merge_object`]) кличе її і на `.json`-таргеті.
/// Скаляр — рядки завжди в подвійних лапках (доккомент [`write_yaml_block`]),
/// решта — той самий текст, що [`write_json`] (валідний і в YAML: `null`/
/// `true`/`false`/число — той самий literal-запис в обох форматах).
fn scalar_literal(v: &Json) -> String {
    match v {
        Json::Str(s) => json_escape_string(s),
        other => {
            let mut out = String::new();
            write_json(other, &mut out);
            out
        }
    }
}

// =====================================================================
// Хірургічний comment-preserving merge (YAML і JSON) — заміна старого
// «розпарсити → перегенерувати з нуля» шляху [`fix_template_merge`] брав
// раніше (звіт задачі, доккомент модуля розділ «ТРЕТЯ хвиля» — виправлений
// нижче за текстом файлу). Джерело правди — `saphyr::MarkedYamlOwned`
// ([`build_mnode`]/[`parse_marked_document`]): той самий парсер, що
// [`parse_yaml_document`], але annotated-варіант несе `Span` (байтовий —
// точніше, char-індексний, звідси [`char_byte_table`] — діапазон кожного
// вузла в ВИХІДНОМУ тексті. Алгоритм — той самий `mergeJsonValue`-обхід, що
// [`merge_json_value`] (той самий [`is_subset`]/[`contained_in`]/
// [`identity_key`]/[`find_identity_index`], перевикористані буквально), але
// замість побудови нового [`Json`]-дерева й серіалізації його з нуля —
// [`surgical_merge_node`] породжує список [`Edit`] (вставка/заміна
// байтового діапазону) і застосовує їх ЗГОРИ ВНИЗ ([`apply_edits`], той
// самий мотив, що `inserts.sort` у [`insert_rust_cache`]/
// [`add_cache_workspaces`] вище): недоторкані діапазони вихідного тексту
// лишаються байт-у-байт як є — коментарі й форматування зберігаються НЕ як
// «намагання», а як структурний наслідок того, що ми ніколи не чіпаємо
// текст поза обчисленими діапазонами.
//
// Коли шлях недосяжний — [`surgical_merge_node`] повертає `false`
// (обʼєкт/масив очікувався, а прийшов інший тип; об�ʼєкт/масив порожній
// (нема на що спертись вставкою); чи для JSON — обчислена точка вставки
// вийшла б ЗА межі власного `}`/`]` контейнера, найпевніше через
// однорядковий/flow-стиль) — [`fix_template_merge`] тоді падає назад на
// СТАРИЙ шлях повної регенерації ([`write_yaml_block`]/
// [`json_to_pretty_string`] над [`merge_json_value`]): завжди коректний
// результат (критерій 1 — повторний детект чистий), не завжди
// comment-preserving (критерій 2) — чесна деградація, не тиха, задокумен-
// тована тут і в звіті задачі, а не видана за повне рішення.
// =====================================================================

/// Один запис редагування вихідного тексту — байтовий діапазон [start,end)
/// замінюється на `text`; `start == end` — чиста вставка (нічого не
/// видаляється).
enum Edit {
    Insert(usize, String),
    Replace(usize, usize, String),
}

fn edit_start(e: &Edit) -> usize {
    match e {
        Edit::Insert(at, _) => *at,
        Edit::Replace(start, _, _) => *start,
    }
}

/// Застосовує список [`Edit`] до `content` — сортує ЗА СПАДАННЯМ початкової
/// позиції (той самий мотив, що `inserts.sort_by` в [`insert_rust_cache`]:
/// індекси попередніх, ще не застосованих правок не зсуваються, коли
/// пізніша (нижче за текстом) правка застосовується першою).
/// Застосовує `edits` у порядку `push` (доккомент [`apply_edits`] пояснює
/// чому це НЕ довільний вибір): [`surgical_merge_node`] — DFS
/// post-order-подібний обхід — дочірні правки завжди `push`-нуться в
/// `edits` РАНІШЕ за правку «бракує ключів» їхнього ВЛАСНОГО батька (та
/// послідовно РАНІШЕ за правки будь-якого предка вище), тож вихідний
/// порядок вектора вже несе інформацію про глибину вкладеності — саме її
/// [`apply_edits`] мусить зберегти на в'язках з однаковою `at`.
fn apply_edits(content: &str, edits: Vec<Edit>) -> String {
    // Вставки на ОДНАКОВІЙ позиції — реальний сценарій, не крайній випадок:
    // коли «останній наявний запис» кількох різних предків (кроку в
    // масиві, job-а, кореня) структурно дном впирається в ТУ САМУ
    // найглибшу скалярну позицію документа (§2.58, доккомент
    // [`deepest_last_leaf_end`]), усі їхні вставки анкеряться в ОДНУ й ТУ
    // САМУ байтову точку. `String::insert_str` при повторній вставці в ТУ
    // САМУ позицію ставить НОВИЙ текст ПЕРЕД раніше вставленим — тож щоб
    // найглибша (найпізніше `push`-нута) правка опинилась НАЙБЛИЖЧЕ до
    // якоря (структурно правильно — вона належить найглибшому контейнеру),
    // її треба застосувати ОСТАННЬОЮ серед в'язки. Сортуємо за спаданням
    // `at`, а в'язки з однаковим `at` — за СПАДАННЯМ індексу `push` (пізніше
    // `push`-нуте — раніше в порядку застосування, отже раніше «зсунуте
    // праворуч» наступними й опиняється НАЙДАЛІ від якоря; найраніше
    // `push`-нуте — найглибше — застосовується останнім і лишається
    // найближче до якоря).
    let mut indexed: Vec<(usize, Edit)> = edits.into_iter().enumerate().collect();
    indexed.sort_by_key(|(idx, e)| (std::cmp::Reverse(edit_start(e)), std::cmp::Reverse(*idx)));
    let mut out = content.to_string();
    for (_, edit) in indexed {
        match edit {
            Edit::Insert(at, text) => out.insert_str(at, &text),
            Edit::Replace(start, end, text) => out.replace_range(start..end, &text),
        }
    }
    out
}

/// [`Json`] з байтовим діапазоном ([`Span`][saphyr::Marker], конвертований
/// з char- у byte-індекси через [`char_byte_table`]) на кожному вузлі —
/// той самий обхід дерева, що [`Json`] (`Scalar`/`Array`/`Object` —
/// [`yaml_owned_to_json`]-подібна форма), лише annotated. Ключі обʼєкта
/// несуть ВЛАСНИЙ діапазон (не лише значення) — потрібен для колонки
/// відступу нового запису при вставці ([`surgical_merge_object`]).
enum MNode {
    Scalar(Json, (usize, usize)),
    Array(Vec<MNode>, (usize, usize)),
    Object(Vec<(String, (usize, usize), MNode)>, (usize, usize)),
}

fn mnode_span(n: &MNode) -> (usize, usize) {
    match n {
        MNode::Scalar(_, s) | MNode::Array(_, s) | MNode::Object(_, s) => *s,
    }
}

/// Байтовий кінець ОСТАННЬОГО скалярного листка в піддереві `n` — НЕ
/// `mnode_span(n).1` напряму: block-стиль YAML не має явного закриваючого
/// токена для мап/масивів, тож `Span.end` контейнера, що є ОСТАННІМ
/// реальним вмістом документа (нема жодного наступного YAML-токена після
/// нього — трейлінг-коментарі НЕ токени, скановані як пробіл), резолвиться
/// в позицію НАСТУПНОЇ події сканера, а не в кінець власного вмісту — на
/// практиці це EOF, ПОЗА трейлінг-коментарем (емпірично перевірено:
/// `saphyr-parser` скановий тест на цьому самому файлі). Скалярний листок
/// натомість завжди має тугий, надійний `Span.end` (кінець власного
/// токена) — рекурсивний спуск до останнього листка обходить цю
/// розбіжність, даючи стабільну точку прив'язки вставки незалежно від
/// позиції в документі.
fn deepest_last_leaf_end(n: &MNode) -> usize {
    match n {
        MNode::Scalar(_, s) => s.1,
        MNode::Array(items, s) => items.last().map_or(s.1, deepest_last_leaf_end),
        MNode::Object(entries, s) => entries.last().map_or(s.1, |(_, _, v)| deepest_last_leaf_end(v)),
    }
}

/// Забуває діапазони — точний відповідник [`yaml_owned_to_json`] над уже
/// побудованим [`MNode`] (використовується для [`is_subset`]/
/// [`contained_in`]/[`find_identity_index`] — ці примітиви оперують
/// [`Json`], не [`MNode`]).
fn mnode_to_json(n: &MNode) -> Json {
    match n {
        MNode::Scalar(j, _) => j.clone(),
        MNode::Array(items, _) => Json::Array(items.iter().map(mnode_to_json).collect()),
        MNode::Object(entries, _) => {
            Json::Object(entries.iter().map(|(k, _, v)| (k.clone(), mnode_to_json(v))).collect())
        }
    }
}

/// Таблиця char-індекс → byte-індекс вихідного тексту — `saphyr::Marker`
/// індексує В СИМВОЛАХ (доккомент поля `Marker::index` каже «bytes», але
/// сканер інкрементує його на кількість ПРОЧИТАНИХ СИМВОЛІВ, не байтів —
/// перевірено читанням `saphyr-parser` scanner-коду; розбіжність
/// зауваження й факту в самому крейті). Кожен наш workflow/JSON-таргет
/// потенційно містить нелатинський текст (українські коментарі/назви
/// job-ів) — байт-індекс і char-індекс розходяться там, тож пряме
/// використання `Marker::index()` як byte-офсету в `&str`-зрізи було б
/// некоректним (панікує чи ріже посеред UTF-8 символу) без цієї таблиці.
#[cfg(feature = "yaml")]
fn char_byte_table(content: &str) -> Vec<usize> {
    let mut table: Vec<usize> = content.char_indices().map(|(b, _)| b).collect();
    table.push(content.len());
    table
}

#[cfg(feature = "yaml")]
fn byte_of(table: &[usize], char_index: usize) -> usize {
    table
        .get(char_index)
        .copied()
        .unwrap_or_else(|| *table.last().unwrap_or(&0))
}

/// Рядковий ключ вузла-мапи annotated-дерева — той самий контракт, що
/// [`yaml_key_to_string`], лише джерело — `MarkedYamlOwned`, не `YamlOwned`.
#[cfg(feature = "yaml")]
fn marked_key_to_string(k: &saphyr::MarkedYamlOwned) -> String {
    use saphyr::{ScalarOwned, YamlDataOwned};
    match &k.data {
        YamlDataOwned::Value(ScalarOwned::String(s)) => s.clone(),
        other => format!("{other:?}"),
    }
}

#[cfg(feature = "yaml")]
fn build_mnode(node: &saphyr::MarkedYamlOwned, table: &[usize]) -> MNode {
    use saphyr::YamlDataOwned;
    let span = (
        byte_of(table, node.span.start.index()),
        byte_of(table, node.span.end.index()),
    );
    match &node.data {
        YamlDataOwned::Value(scalar) => MNode::Scalar(scalar_owned_to_json(scalar), span),
        YamlDataOwned::Sequence(items) => {
            MNode::Array(items.iter().map(|n| build_mnode(n, table)).collect(), span)
        }
        YamlDataOwned::Mapping(map) => MNode::Object(
            map.iter()
                .map(|(k, v)| {
                    let key_span = (
                        byte_of(table, k.span.start.index()),
                        byte_of(table, k.span.end.index()),
                    );
                    (marked_key_to_string(k), key_span, build_mnode(v, table))
                })
                .collect(),
            span,
        ),
        // `Representation`/`Tagged`/`Alias`/`BadValue` — той самий
        // skip-not-crash фолбек, що [`yaml_owned_to_json`] (доккомент
        // там): порівняння з очікуваним snippet-ом просто не збіжеться
        // (`Json::Null`), [`surgical_merge_node`] тоді або замінить цей
        // вузол на канонічний, або (якщо він мав бути обʼєктом/масивом)
        // впаде в fallback.
        _ => MNode::Scalar(Json::Null, span),
    }
}

/// Той самий подвійний fallback, що [`parse_yaml_document`] (парс-помилка
/// чи не-обʼєктний корінь → `None`), лише annotated-дерево зі спанами.
#[cfg(feature = "yaml")]
fn parse_marked_document(content: &str) -> Option<MNode> {
    use saphyr::{LoadableYamlNode, MarkedYamlOwned};
    let table = char_byte_table(content);
    let docs = MarkedYamlOwned::load_from_str(content).ok()?;
    let doc = docs.into_iter().next()?;
    let node = build_mnode(&doc, &table);
    match &node {
        MNode::Object(..) => Some(node),
        _ => None,
    }
}

/// Колонка байтового офсету в його рядку (кількість байтів від початку
/// рядка) — та сама байтова, не char-міра, що [`indent_of`] (той самий
/// мотив: відступ/структурні маркери завжди ASCII в цих файлах).
fn column_at(content: &str, byte_offset: usize) -> usize {
    let line_start = content[..byte_offset].rfind('\n').map_or(0, |i| i + 1);
    byte_offset - line_start
}

/// Байтовий офсет ПОЧАТКУ рядка, що йде ПІСЛЯ рядка, який містить
/// `from_byte` — `None`, якщо `from_byte` на останньому рядку файлу (нема
/// куди безпечно вставити повний новий рядок ПЕРЕД можливим закриттям
/// контейнера) — той самий guard-мотив, що обмеження нижче в
/// [`surgical_merge_object`]/[`surgical_merge_array`] для JSON.
fn next_line_start(content: &str, from_byte: usize) -> Option<usize> {
    content.get(from_byte..)?.find('\n').map(|rel| from_byte + rel + 1)
}

/// `true`, якщо одразу після байтового офсету `pos` (пропускаючи лише ASCII
/// пробіли/таби/переведення рядка — НЕ коментарі, доккомент нижче) уже
/// стоїть кома — JSONC (на відміну від floor `is_strict_json`, який
/// повністю відхиляв trailing-кому) дозволяє її, тож
/// [`surgical_merge_object`]/[`surgical_merge_array`] НЕ мають дописувати
/// ДРУГУ (подвійна кома — синтаксично невалідний JSON; [`try_surgical_merge`]
/// post-generation guard спіймав би це й відкотився на повну регенерацію,
/// але безпечніше не створювати сам випадок). Комент МІЖ значенням і його
/// власною комою — нетиповий стиль (жодна з фікстур задачі його не має) —
/// НЕ розпізнається тут навмисно (спрощення, не баг): найгірший наслідок —
/// той самий post-generation guard ловить подвійну кому й падає на
/// коректний, лише не-хірургічний fallback, той самий «чесна деградація»
/// контракт, що решта цього модуля.
fn already_has_trailing_comma(content: &str, pos: usize) -> bool {
    content[pos..].trim_start_matches([' ', '\t', '\r', '\n']).starts_with(',')
}

// --- Flow-стиль inline-вставка (§2.62 звузила виміряну межу §2.61 з
// «anchor/alias І flow-стиль непідтримні разом» до РІВНО одного класу:
// вставка ВСЕРЕДИНУ однорядкового flow-контейнера (`{…}`/`[…]`) —
// [`next_line_start`] шукає `\n` ПІСЛЯ якоря, щоб вставити НОВИЙ рядок, а в
// однорядковому flow-контейнері такого `\n` нема, тож [`surgical_merge_object`]/
// [`surgical_merge_array`] падали в `None` навіть коли решта дерева (анкер/
// аліас, звичайний block-стиль) мержилась би хірургічно. Наслідок —
// каскадний all-or-nothing провал ([`surgical_merge_node`] пробрасує `false`
// від будь-якого дочірнього виклику до самого кореня): ОДНА нездійсненна
// flow-вставка будь-де в дереві валила ВЕСЬ документ на повну регенерацію,
// втрачаючи ВСІ коментарі файлу, не лише ті, що біля flow-вузла. §2.62 оцінила
// латку в ~80–150 рядків, без нової залежності, без приросту розміру гостя —
// саме це нижче.
//
// Ключ рушія — [`flow_insert_point`]: на відміну від block-стилю, де немає
// явного закриваючого токена (§2.58, [`deepest_last_leaf_end`]), flow-
// контейнер МАЄ явний `}`/`]`, і `MarkedYamlOwned`-спан вузла дає його
// офсет ТОЧНО (перевірено емпірично — доккомент функції нижче): вставка
// відбувається безпосередньо ПЕРЕД цим байтом, з комою-роздільником лише
// коли потрібно, БЕЗ жодного переносу рядка. ---

/// `true`, якщо вузол `actual` — flow-стиль (перший байт його спану —
/// відкриваючий `{`/`[`, а не перший символ першого ключа/елемента, як у
/// block-стилі). `open` — очікуваний відкриваючий байт (`b'{'` для обʼєкта,
/// `b'['` для масиву) — розрізняти два випадки одним викликом безпечно, бо
/// [`MNode::Object`] не може фізично починатись з `[`, і навпаки.
///
/// Гейт `feature = "yaml"` — обидва виклики цієї функції під ним
/// (`surgical_merge_object`/`surgical_merge_array`): flow-стиль це YAML-
/// специфіка, у JSONC-only збірці (`rules-core`) гілка не існує взагалі.
/// Без гейта та збірка отримувала б `dead_code`-варнінг — тобто шум замість
/// сигналу.
#[cfg(feature = "yaml")]
fn is_flow_container(content: &str, span: (usize, usize), open: u8) -> bool {
    content.as_bytes().get(span.0) == Some(&open)
}

/// Байтовий офсет закриваючого `}`/`]` вузла flow-контейнера, і префікс
/// (кома-роздільник чи порожній рядок), який слід вставити ПЕРЕД новим
/// вмістом. **Пастка, знайдена ЛИШЕ емпіричною перевіркою спанів
/// (`saphyr::MarkedYamlOwned`), не документацією крейта:** на відміну від
/// НАЇВНОГО припущення «flow МАЄ явний закриваючий токен, тож `Span.end`
/// вказує ОДРАЗУ ЗА ним» (як для скалярного листка, §2.58) — для flow-
/// контейнера `Span.end` дорівнює ТОЧНОМУ офсету самого закриваючого байта
/// (не `span.1 - 1`, а РІВНО `span.1`); той самий клас розбіжності
/// «зауваження vs факт сканера», що вже задокументований для
/// `Marker::index()` ([`char_byte_table`]) і для контейнерів-останнього-
/// вмісту-документа ([`deepest_last_leaf_end`]), лише в інший бік
/// (тугіше, не слабше, ніж наївне припущення). Перевірено прямим виводом
/// спанів на фікстурах `{}`/`[]`/`{push: {branches: [main]}}` (звіт задачі,
/// не залишено в крейті як тест — сам факт закодований у цій функції й
/// перевіряється НЕПРЯМО кожним flow-тестом нижче через byte-точний
/// `assert_eq!` на результаті).
///
/// Кома потрібна, якщо вміст контейнера (усе між `{`/`[` і закриваючим
/// байтом, з обрізаними КІНЦЕВИМИ ASCII-пробілами) непорожній і ще не
/// закінчується комою (той самий трейлінг-комою мотив, що
/// [`already_has_trailing_comma`], лише скануючи НАЗАД від точки вставки —
/// дзеркальний напрямок, бо flow-вставка завжди відбувається ПЕРЕД
/// закриваючим токеном, не ПІСЛЯ останнього елемента).
///
/// Гейт `feature = "yaml"` — той самий мотив, що [`is_flow_container`].
#[cfg(feature = "yaml")]
fn flow_insert_point(content: &str, span: (usize, usize)) -> (usize, &'static str) {
    let close_at = span.1;
    let inner = content[span.0 + 1..close_at].trim_end_matches([' ', '\t', '\r', '\n']);
    let prefix = if inner.is_empty() {
        "" // порожній контейнер (`{}`/`[]`) — перший елемент, кома не потрібна.
    } else if inner.ends_with(',') {
        " " // trailing-кома вже є — лише пробіл-роздільник, не друга кома.
    } else {
        ", "
    };
    (close_at, prefix)
}

/// Inline-серіалізатор [`Json`] для flow-контексту — БЕЗ жодного переносу
/// рядка (на відміну від [`write_yaml_object_entries`]/
/// [`write_yaml_array_items`], бо вставка відбувається ВСЕРЕДИНУ
/// однорядкового контейнера — block-стиль дочірнього вузла тут синтаксично
/// недопустимий у YAML). Рекурсивний — вкладений обʼєкт/масив у ЩОЙНО
/// вставленому дереві теж пишеться flow-стилем (`{k: v, …}`/`[e, …]`).
/// Скаляри — той самий [`scalar_literal`], що block-шлях (рядки завжди в
/// подвійних лапках, доккомент [`write_yaml_block`]).
#[cfg(feature = "yaml")]
fn write_yaml_flow_value(v: &Json, out: &mut String) {
    match v {
        Json::Object(entries) => {
            out.push('{');
            for (i, (k, val)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                out.push_str(&yaml_key(k));
                out.push_str(": ");
                write_yaml_flow_value(val, out);
            }
            out.push('}');
        }
        Json::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push_str(", ");
                }
                write_yaml_flow_value(item, out);
            }
            out.push(']');
        }
        scalar => out.push_str(&scalar_literal(scalar)),
    }
}

/// Обхід ОДНОГО вузла snippet-а проти відповідного [`MNode`] наявного
/// тексту — точний семантичний відповідник [`merge_json_value`], лише
/// замість побудови нового значення накопичує [`Edit`]-и в `edits`.
/// Повертає `false`, якщо цей шлях не можна виразити хірургічно (доккомент
/// розділу вище) — виклична сторона тоді падає на повну регенерацію.
fn surgical_merge_node(
    content: &str,
    actual: &MNode,
    snippet: &Json,
    format: Format,
    edits: &mut Vec<Edit>,
) -> bool {
    match snippet {
        Json::Object(entries) => surgical_merge_object(content, actual, entries, format, edits),
        Json::Array(items) => surgical_merge_array(content, actual, items, format, edits),
        leaf => mnode_to_json(actual) == *leaf,
    }
}

/// Обʼєктна гілка [`surgical_merge_node`] — точний відповідник обʼєктної
/// гілки [`merge_json_value`]: присутні ключі — рекурсія (листя, що
/// розійшлись, — [`Edit::Replace`] на діапазоні наявного скаляра);
/// відсутні ключі — один [`Edit::Insert`] (усі відсутні ключі одним блоком,
/// не окремими вставками в ту саму позицію) одразу ПІСЛЯ останнього
/// наявного запису.
fn surgical_merge_object(
    content: &str,
    actual: &MNode,
    snippet_entries: &[(String, Json)],
    format: Format,
    edits: &mut Vec<Edit>,
) -> bool {
    let MNode::Object(a_entries, obj_span) = actual else {
        return false;
    };
    let mut missing: Vec<(&str, &Json)> = Vec::new();
    for (k, v) in snippet_entries {
        match a_entries.iter().find(|(ak, _, _)| ak == k) {
            Some((_, _, a_child)) => match v {
                Json::Object(_) | Json::Array(_) => {
                    if !surgical_merge_node(content, a_child, v, format, edits) {
                        return false;
                    }
                }
                leaf => {
                    if mnode_to_json(a_child) != *leaf {
                        let MNode::Scalar(_, span) = a_child else {
                            return false;
                        };
                        edits.push(Edit::Replace(span.0, span.1, scalar_literal(leaf)));
                    }
                }
            },
            None => missing.push((k.as_str(), v)),
        }
    }
    if missing.is_empty() {
        return true;
    }
    // Flow-стиль (`{…}`) — inline-вставка ПЕРЕД закриваючим `}`, без
    // переносу рядка (доккомент розділу «Flow-стиль inline-вставка» вище).
    // Перевіряється ДО `a_entries.last()`-guard-у нижче: порожній flow-
    // обʼєкт (`{}`) не має наявного запису, після якого вставляти (block-
    // шлях впав би в fallback), але для flow це РІВНО той самий «перший
    // елемент, кома не потрібна» випадок, що [`flow_insert_point`] уже
    // розпізнає — не крайній випадок, гілка нижче.
    #[cfg(feature = "yaml")]
    if format.is_yaml() && is_flow_container(content, *obj_span, b'{') {
        let (insert_at, prefix) = flow_insert_point(content, *obj_span);
        let mut block = prefix.to_string();
        for (i, (k, v)) in missing.iter().enumerate() {
            if i > 0 {
                block.push_str(", ");
            }
            block.push_str(&yaml_key(k));
            block.push_str(": ");
            write_yaml_flow_value(v, &mut block);
        }
        edits.push(Edit::Insert(insert_at, block));
        return true;
    }
    let Some((_, last_key_span, last_value)) = a_entries.last() else {
        return false; // порожній обʼєкт — нема запису, після якого вставляти.
    };
    let level = column_at(content, last_key_span.0) / 2;
    let anchor_end = deepest_last_leaf_end(last_value);
    let Some(insert_at) = next_line_start(content, anchor_end) else {
        return false;
    };
    if !format.is_yaml() && insert_at >= obj_span.1 {
        return false; // точка вставки вийшла б за межі власного `}`.
    }
    let mut block = String::new();
    match format {
        #[cfg(feature = "yaml")]
        Format::Yaml => {
            for (k, v) in &missing {
                write_yaml_object_entries(&[((*k).to_string(), (*v).clone())], level, &mut block);
            }
        }
        Format::Jsonc => {
        let pad = "  ".repeat(level);
        for (i, (k, v)) in missing.iter().enumerate() {
            if i > 0 {
                block.push_str(",\n");
            }
            block.push_str(&pad);
            block.push_str(&json_escape_string(k));
            block.push_str(": ");
            write_json_pretty(v, level, &mut block);
        }
            block.push('\n');
            if !already_has_trailing_comma(content, anchor_end) {
                edits.push(Edit::Replace(anchor_end, anchor_end, ",".to_string()));
            }
        }
    }
    edits.push(Edit::Insert(insert_at, block));
    true
}

/// Масивна гілка [`surgical_merge_node`] — точний відповідник масивної
/// гілки [`merge_json_value`]: [`contained_in`] — no-op; [`find_identity_index`]
/// — рекурсія в елемент on-place; інакше — один [`Edit::Insert`] з усіма
/// відсутніми елементами одразу ПІСЛЯ останнього наявного.
fn surgical_merge_array(
    content: &str,
    actual: &MNode,
    snippet_items: &[Json],
    format: Format,
    edits: &mut Vec<Edit>,
) -> bool {
    let MNode::Array(a_items, arr_span) = actual else {
        return false;
    };
    let a_items_json: Vec<Json> = a_items.iter().map(mnode_to_json).collect();
    let mut missing: Vec<Json> = Vec::new();
    for needle in snippet_items {
        if contained_in(&a_items_json, needle) {
            continue;
        }
        match find_identity_index(&a_items_json, needle) {
            Some(idx) => {
                if !surgical_merge_node(content, &a_items[idx], needle, format, edits) {
                    return false;
                }
            }
            None => missing.push(needle.clone()),
        }
    }
    if missing.is_empty() {
        return true;
    }
    // Flow-стиль (`[…]`) — той самий inline-мотив, що обʼєктна гілка вище.
    #[cfg(feature = "yaml")]
    if format.is_yaml() && is_flow_container(content, *arr_span, b'[') {
        let (insert_at, prefix) = flow_insert_point(content, *arr_span);
        let mut block = prefix.to_string();
        for (i, v) in missing.iter().enumerate() {
            if i > 0 {
                block.push_str(", ");
            }
            write_yaml_flow_value(v, &mut block);
        }
        edits.push(Edit::Insert(insert_at, block));
        return true;
    }
    let Some(last_item) = a_items.last() else {
        return false; // порожній масив — нема елемента, після якого вставляти.
    };
    let last_start = mnode_span(last_item).0;
    let last_end = deepest_last_leaf_end(last_item);
    let item_col = column_at(content, last_start);
    let dash_col = item_col.saturating_sub(2);
    let Some(insert_at) = next_line_start(content, last_end) else {
        return false;
    };
    if !format.is_yaml() && insert_at >= arr_span.1 {
        return false; // точка вставки вийшла б за межі власного `]`.
    }
    let mut block = String::new();
    match format {
        #[cfg(feature = "yaml")]
        Format::Yaml => write_yaml_array_items(&missing, dash_col / 2, &mut block),
        Format::Jsonc => {
        let pad = "  ".repeat(dash_col / 2);
        for (i, v) in missing.iter().enumerate() {
            if i > 0 {
                block.push_str(",\n");
            }
            block.push_str(&pad);
            write_json_pretty(v, dash_col / 2, &mut block);
        }
            block.push('\n');
            if !already_has_trailing_comma(content, last_end) {
                edits.push(Edit::Replace(last_end, last_end, ",".to_string()));
            }
        }
    }
    edits.push(Edit::Insert(insert_at, block));
    true
}

/// Публічний вхід хірургічного шляху — `None`, якщо наявний текст
/// непарситься annotated-парсером ([`parse_marked_document`] для YAML,
/// [`parse_marked_jsonc_document`] для JSON — не мало б статись,
/// [`fix_template_merge`] уже перевірив [`parse_target_document`] на тому
/// самому `content` вище) чи якщо [`surgical_merge_node`] десь по дорозі
/// впала в непідтримуваний випадок — виклична сторона (`fix_template_merge`)
/// падає на повну регенерацію.
/// `None` — хірургічний шлях недосяжний ЧИ (незалежно від причини)
/// результат не пройшов ПОСТ-ГЕНЕРАЦІЙНУ перевірку коректності (доккомент
/// нижче) — виклична сторона (`fix_template_merge`) падає на повну
/// регенерацію в ОБОХ випадках однаково.
pub fn try_surgical_merge(content: &str, snippet: &Json, format: Format) -> Option<String> {
    let root = match format {
        #[cfg(feature = "yaml")]
        Format::Yaml => parse_marked_document(content)?,
        Format::Jsonc => parse_marked_jsonc_document(content)?,
    };
    let mut edits = Vec::new();
    if !surgical_merge_node(content, &root, snippet, format, &mut edits) {
        return None;
    }
    if edits.is_empty() {
        // `is_subset` вище в `fix_template_merge` уже встановив, що щось
        // відрізняється — порожній `edits` тут означав би розбіжність між
        // цим обходом і `is_subset`-семантикою: безпечніше відкотитись на
        // регенерацію, ніж мовчки повернути незмінний текст.
        return None;
    }
    let result = apply_edits(content, edits);
    // Обовʼязковий post-generation guard (рішення власника репозиторію,
    // звіт задачі — незалежна перевірка на реальній фікстурі з кількома
    // одночасними вставками на різних рівнях вклад дала невалідний YAML,
    // хоч усі юніт-тести цього модуля були зелені): коректність байтового
    // splice-у НЕ приймається на віру з побудови — результат ПОВТОРНО
    // парситься тим самим [`parse_yaml_document`], що виклична сторона
    // використовує для `actual`, і звіряється [`is_subset`]-ом проти
    // ТОГО САМОГО snippet-а, що й [`fix_template_merge`] звіряв ДО фіксу
    // (той самий контракт, що «повторний детект чистий»). Будь-яка
    // невідповідність — синтаксична (побитий YAML/JSON) чи семантична
    // (результат усе ще НЕ задовольняє snippet, симптом помилково
    // обчисленого якоря чи порядку застосування правок) — трактується
    // ОДНАКОВО: `None`, `fix_template_merge` падає на стару повну
    // регенерацію. Це не «спробувати й подивитись», а «перевірити перед
    // тим, як віддати» — ціна фальшивого fallback-у (втрачені коментарі на
    // рідкісному дереві, де хірургічний шлях насправді спрацював би)
    // прийнятна; ціна протилежної помилки (відданий побитий YAML/JSON
    // користувачу) — ні. [`parse_target_document`] — той самий диспетчер,
    // що [`fix_template_merge`] використав для `actual` ДО фіксу: JSON-гілка
    // тепер реально перевіряє JSONC-сумісний результат ([`parse_jsonc_document`]),
    // не YAML-парсер (доккомент розділу «Справжня JSONC-підтримка») —
    // подвійна вставка чи зіпсований байтовий діапазон на `.json`-таргеті
    // ловиться ТУТ так само надійно, як на `.yml`.
    let reparsed = parse_target_document(&result, format)?;
    if !is_subset(Some(&reparsed), snippet) {
        return None;
    }
    Some(result)
}
#[cfg(test)]
mod tests {
    //! Юніт-покриття двигуна — перенесено разом із кодом із
    //! `crates/plugin-ci-github/src/lib.rs`: тести їдуть за тим, що вони
    //! перевіряють, інакше крейт лишився б без власних гейтів, а регресію
    //! ловив би лише суїт стороннього споживача.
    use super::*;

    #[cfg(feature = "yaml")]
    #[test]
    fn parse_yaml_document_scalar_root_is_none() {
        assert_eq!(parse_yaml_document("just a string\n"), None);
        assert_eq!(parse_yaml_document("- 1\n- 2\n"), None);
    }

    #[cfg(feature = "yaml")]
    #[test]
    fn parse_yaml_document_invalid_syntax_is_none() {
        assert_eq!(parse_yaml_document("name: [unterminated\n"), None);
    }

    #[cfg(feature = "yaml")]
    #[test]
    fn parse_yaml_document_on_key_stays_string_yaml_12() {
        // YAML 1.2 (saphyr) — на відміну від Go-yaml conftest (YAML 1.1) —
        // НІКОЛИ не читає голий `on:` як булевий ключ. Той самий парсер, що
        // й `yaml` npm-пакет канону.
        let root = parse_yaml_document("on:\n  push: {}\n").expect("валідний YAML-обʼєкт");
        assert!(root.get("on").is_some());
        assert!(root.get("true").is_none());
    }

    #[cfg(feature = "yaml")]
    #[test]
    fn parse_yaml_document_nested_mapping_and_sequence() {
        let root = parse_yaml_document(
            "name: CI\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v6\n      - run: echo hi\n",
        )
        .expect("валідний YAML-обʼєкт");
        assert_eq!(root.get("name").and_then(Json::as_str), Some("CI"));
        let steps = root
            .get("jobs")
            .and_then(|j| j.get("build"))
            .and_then(|b| b.get("steps"))
            .and_then(Json::as_array);
        let steps = steps.expect("steps — масив");
        assert_eq!(steps.len(), 2);
        assert_eq!(
            steps[0].get("uses").and_then(Json::as_str),
            Some("actions/checkout@v6")
        );
    }

    #[test]
    fn json_to_string_escapes_and_types_correctly() {
        let value = Json::Object(vec![
            ("s".to_string(), Json::Str("a\"b\n".to_string())),
            ("n".to_string(), Json::Int(-5)),
            ("f".to_string(), Json::Float(1.5)),
            ("b".to_string(), Json::Bool(true)),
            ("nil".to_string(), Json::Null),
            (
                "arr".to_string(),
                Json::Array(vec![Json::Int(1), Json::Int(2)]),
            ),
        ]);
        let text = json_to_string(&value);
        assert!(text.contains("\"s\":\"a\\\"b\\n\""));
        assert!(text.contains("\"n\":-5"));
        assert!(text.contains("\"f\":1.5"));
        assert!(text.contains("\"b\":true"));
        assert!(text.contains("\"nil\":null"));
        assert!(text.contains("\"arr\":[1,2]"));
    }

    #[cfg(feature = "yaml")]
    /// Flow-послідовність у корені документа (`branches: [main]`, точна
    /// фікстура з постановки) — вставка НОВОГО елемента поряд з наявним
    /// (потрібна кома-роздільник). Рядкові скаляри — той самий double-quote
    /// контракт, що [`yaml_scalar`] на block-шляху (жодного вгадування
    /// безпечності plain-форми).
    #[test]
    fn surgical_merge_flow_sequence_root_insert_appends_with_comma() {
        let before = "on:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet = parse_yaml_document(
            "on:\n  push:\n    branches: [main, dev]\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
        )
        .expect("snippet валідний YAML");
        let result = try_surgical_merge(before, &snippet, Format::Yaml)
            .expect("flow-послідовність має мержитись хірургічно, без fallback на регенерацію");
        assert_eq!(
            result,
            "on:\n  push:\n    branches: [main, \"dev\"]\njobs:\n  build:\n    runs-on: ubuntu-latest\n"
        );
        let reparsed = parse_yaml_document(&result).expect("вивід — валідний YAML");
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    #[cfg(feature = "yaml")]
    /// Порожній flow-масив (`[]`) — перший елемент НЕ потребує коми-
    /// роздільника (`flow_insert_point` розпізнає порожній вміст).
    #[test]
    fn surgical_merge_flow_sequence_empty_insert_first_no_comma() {
        let before = "tags: []\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet =
            parse_yaml_document("tags: [v1]\njobs:\n  build:\n    runs-on: ubuntu-latest\n").unwrap();
        let result = try_surgical_merge(before, &snippet, Format::Yaml)
            .expect("порожній flow-масив має отримати перший елемент без коми");
        assert_eq!(result, "tags: [\"v1\"]\njobs:\n  build:\n    runs-on: ubuntu-latest\n");
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    #[cfg(feature = "yaml")]
    /// Порожня flow-мапа (`{}`) — симетричний випадок для обʼєктної гілки.
    #[test]
    fn surgical_merge_flow_mapping_empty_insert_first_no_comma() {
        let before = "permissions: {}\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet = parse_yaml_document(
            "permissions: {contents: read}\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
        )
        .unwrap();
        let result = try_surgical_merge(before, &snippet, Format::Yaml)
            .expect("порожня flow-мапа має отримати перший ключ без коми");
        assert_eq!(
            result,
            "permissions: {\"contents\": \"read\"}\njobs:\n  build:\n    runs-on: ubuntu-latest\n"
        );
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    #[cfg(feature = "yaml")]
    /// Вкладена flow-мапа (`on: {push: {branches: [main]}}`, точна фікстура
    /// з постановки) — вставка ОДНОЧАСНО на верхньому рівні (`on`, сусідній
    /// ключ `workflow_dispatch` поряд з `push`) і на вкладеному (`push`,
    /// сусідній ключ `tags` поряд з `branches`). Обидва рівні — окремі
    /// [`Edit::Insert`] на різних байтових офсетах, обчислені проти
    /// ОРИГІНАЛЬНОГО тексту (той самий мотив, що [`apply_edits`] — порядок
    /// застосування не впливає на коректність, бо офсети не перетинаються).
    #[test]
    fn surgical_merge_flow_mapping_nested_and_top_level_insert() {
        let before = "on: {push: {branches: [main]}}\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet = parse_yaml_document(concat!(
            "on: {push: {branches: [main], tags: dev-tag}, workflow_dispatch: {}}\n",
            "jobs:\n  build:\n    runs-on: ubuntu-latest\n",
        ))
        .unwrap();
        let result = try_surgical_merge(before, &snippet, Format::Yaml).expect(
            "вставка і на верхньому, і на вкладеному рівні flow-мапи має бути хірургічною",
        );
        assert_eq!(
            result,
            concat!(
                "on: {push: {branches: [main], \"tags\": \"dev-tag\"}, \"workflow_dispatch\": {}}\n",
                "jobs:\n  build:\n    runs-on: ubuntu-latest\n",
            )
        );
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    #[cfg(feature = "yaml")]
    /// Flow-контейнер з наявною trailing-комою (`[main,]` — валідний YAML,
    /// перевірено окремо через `saphyr::YamlOwned::load_from_str` перед
    /// написанням цього тесту) — [`flow_insert_point`] НЕ має дописувати
    /// ДРУГУ кому (дзеркальний мотив до [`already_has_trailing_comma`] на
    /// JSON block-шляху, лише скануючи НАЗАД від точки вставки, не вперед).
    #[test]
    fn surgical_merge_flow_sequence_existing_trailing_comma_not_doubled() {
        let before = "branches: [main,]\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let snippet =
            parse_yaml_document("branches: [main, dev]\njobs:\n  build:\n    runs-on: ubuntu-latest\n")
                .unwrap();
        let result = try_surgical_merge(before, &snippet, Format::Yaml)
            .expect("наявна trailing-кома не має блокувати хірургічну вставку");
        assert!(!result.contains(",,"), "подвійна кома: {result}");
        assert_eq!(result, "branches: [main, \"dev\"]\njobs:\n  build:\n    runs-on: ubuntu-latest\n");
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    #[cfg(feature = "yaml")]
    /// Найважливіший тест — точно той каскад, що §2.61 виміряла як «anchor
    /// І flow непідтримні разом», а §2.62 звузила до «лише flow-nested-
    /// insert» (доккомент розділу вище): документ, де flow-контейнер
    /// (`branches: […]`) СУСІДИТЬ із коментарями в іншій частині того
    /// самого дерева (`# top-level file comment`, трейлінг-коментар на
    /// самій flow-лінії) і потребує ЩЕ ОДНОЇ, окремої block-style вставки
    /// на кореневому рівні (`concurrency`). ДО фіксу — [`surgical_merge_node`]
    /// пробрасує `false` від flow-гілки вгору (`if !surgical_merge_node(…)
    /// { return false; }`, обхід «все або нічого») аж до кореня,
    /// [`try_surgical_merge`] повертає `None`, ВЕСЬ документ (включно з
    /// block-вставкою `concurrency`, яка сама по собі хірургічна) валиться
    /// на повну регенерацію — ВСІ коментарі втрачаються. ПІСЛЯ фіксу — обидві
    /// вставки (flow і block) застосовуються хірургічно, коментарі
    /// зберігаються.
    #[test]
    fn surgical_merge_mixed_flow_inside_block_tree_preserves_all_comments() {
        let before = concat!(
            "# top-level file comment\n",
            "name: CI\n",
            "\n",
            "on:\n",
            "  push:\n",
            "    branches: [main] # trailing comment on flow line\n",
            "\n",
            "jobs:\n",
            "  build:\n",
            "    runs-on: ubuntu-latest\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
        );
        let snippet = parse_yaml_document(concat!(
            "name: CI\n",
            "on:\n",
            "  push:\n",
            "    branches: [main, dev]\n",
            "jobs:\n",
            "  build:\n",
            "    runs-on: ubuntu-latest\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
            "concurrency:\n",
            "  group: x\n",
        ))
        .unwrap();
        let result = try_surgical_merge(before, &snippet, Format::Yaml).expect(
            "ОДНА нездійсненна вставка всередині flow-контейнера НЕ має валити весь мердж на \
             повну регенерацію — саме той каскад, що §2.61 виміряла як «anchor/flow непідтримні \
             разом»",
        );
        assert!(result.contains("# top-level file comment"));
        assert!(result.contains("branches: [main, \"dev\"] # trailing comment on flow line"));
        assert!(result.contains("concurrency"));
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    #[cfg(feature = "yaml")]
    /// РЕГРЕСІЯ — anchor/alias БЕЗ жодного flow (§2.62: «анкер/аліас уже
    /// працює в нашому власному [`try_surgical_merge`], без жодного крейта»,
    /// не має регресувати від додавання flow-підтримки). Три коментарі
    /// (файловий, інлайновий на полі anchor-мапи, і перед `steps:` у job-і,
    /// що використовує `<<: *common`) мусять вижити 3/3.
    #[test]
    fn surgical_merge_anchor_alias_regression_all_comments_preserved() {
        let before = concat!(
            "# top-level file comment\n",
            "x-common: &common\n",
            "  timeout-minutes: 5 # anchor field comment\n",
            "  runs-on: ubuntu-latest\n",
            "\n",
            "jobs:\n",
            "  security:\n",
            "    <<: *common\n",
            "    # job comment before steps\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
        );
        let snippet = parse_yaml_document(concat!(
            "jobs:\n",
            "  security:\n",
            "    steps:\n",
            "      - uses: actions/checkout@v6\n",
            "concurrency:\n",
            "  group: x\n",
        ))
        .unwrap();
        let result = try_surgical_merge(before, &snippet, Format::Yaml)
            .expect("anchor/alias без flow має мержитись хірургічно (без регресії від §2.62-фіксу)");
        assert!(result.contains("# top-level file comment"));
        assert!(result.contains("timeout-minutes: 5 # anchor field comment"));
        assert!(result.contains("# job comment before steps"));
        assert!(result.contains("<<: *common"));
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    #[cfg(feature = "yaml")]
    /// РЕГРЕСІЯ — чистий block-стиль (жодного flow, жодного anchor), точно
    /// такий, як мержився ДО цієї задачі — не має змінити поведінку.
    #[test]
    fn surgical_merge_pure_block_style_regression_unaffected_by_flow_support() {
        let before = concat!(
            "name: X\n",
            "# comment before jobs\n",
            "jobs:\n",
            "  build:\n",
            "    runs-on: ubuntu-latest\n",
        );
        let snippet = parse_yaml_document(concat!(
            "name: X\n",
            "jobs:\n",
            "  build:\n",
            "    runs-on: ubuntu-latest\n",
            "concurrency:\n",
            "  group: x\n",
        ))
        .unwrap();
        let result = try_surgical_merge(before, &snippet, Format::Yaml)
            .expect("block-стиль surgical merge має спрацювати як і раніше");
        assert!(result.contains("# comment before jobs"));
        let reparsed = parse_yaml_document(&result).unwrap();
        assert!(is_subset(Some(&reparsed), &snippet));
    }

    #[test]
    fn parse_jsonc_document_accepts_plain_json_object_root() {
        let parsed = parse_jsonc_document(r#"{"a":1,"b":[true,false,null,"x",1.5e10],"c":{}}"#)
            .expect("звичайний JSON без коментарів мусить парситись");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
    }

    #[test]
    fn parse_jsonc_document_accepts_leading_line_comment() {
        let parsed = parse_jsonc_document("{\n  // коментар\n  \"a\": 1\n}\n")
            .expect("справжня JSONC-підтримка мусить приймати `//`-коментар");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
    }

    #[test]
    fn parse_jsonc_document_accepts_trailing_line_comment() {
        let parsed = parse_jsonc_document("{\"a\": 1 // коментар\n}")
            .expect("хвостовий `//`-коментар на рядку значення мусить прийматись");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
    }

    #[test]
    fn parse_jsonc_document_accepts_block_comment() {
        let parsed = parse_jsonc_document("{\n  /* блоковий коментар */\n  \"a\": 1\n}\n")
            .expect("блоковий `/* */`-коментар мусить прийматись");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
    }

    #[test]
    fn parse_jsonc_document_accepts_trailing_comma() {
        let parsed =
            parse_jsonc_document(r#"{"a":1,}"#).expect("trailing-кома в обʼєкті мусить прийматись");
        assert_eq!(parsed.get("a"), Some(&Json::Int(1)));
        let arr = parse_jsonc_document(r#"{"a":[1,2,]}"#)
            .expect("trailing-кома в масиві мусить прийматись")
            .get("a")
            .and_then(Json::as_array)
            .map(<[Json]>::len);
        assert_eq!(arr, Some(2));
    }

    /// Не-обʼєктний корінь (масив/скаляр) — той самий подвійний fallback, що
    /// [`parse_yaml_document`] (доккомент [`parse_jsonc_document`]): валідний
    /// синтаксично, але `None` за контрактом «нам потрібен обʼєкт».
    #[test]
    fn parse_jsonc_document_rejects_non_object_root() {
        assert!(parse_jsonc_document("[]").is_none());
        assert!(parse_jsonc_document("\"тест\"").is_none());
        assert!(parse_jsonc_document("-0.5").is_none());
    }

    /// [`jsonc_parse_options`] обмежує дефолтну JSON5-подібну поведінку
    /// крейта до РІВНО контракту JSONC (доккомент розділу) — unquoted-ключі
    /// (JSON5, не JSONC) лишаються ВІДХИЛЕНІ, той самий floor, що
    /// `is_strict_json` мав раніше.
    #[test]
    fn parse_jsonc_document_rejects_unquoted_key() {
        assert!(parse_jsonc_document("{a: 1}").is_none());
    }

    #[test]
    fn parse_jsonc_document_rejects_single_quotes() {
        assert!(parse_jsonc_document("{'a': 1}").is_none());
    }

    #[test]
    fn parse_jsonc_document_rejects_trailing_garbage() {
        assert!(parse_jsonc_document("{}garbage").is_none());
    }

    #[test]
    fn parse_jsonc_document_rejects_broken_syntax() {
        assert!(parse_jsonc_document("{ not valid json").is_none());
    }

    /// [`parse_marked_jsonc_document`] — той самий подвійний fallback
    /// annotated-варіанту, і байтові `Range` НЕ включають коментар (той
    /// самий «trivia»-контракт, що робить хірургічний шлях
    /// comment-preserving — доккомент розділу).
    #[test]
    fn parse_marked_jsonc_document_span_excludes_leading_comment() {
        let content = "{\n  // коментар\n  \"a\": 1\n}\n";
        let root = parse_marked_jsonc_document(content).expect("валідний JSONC");
        let MNode::Object(entries, _) = &root else {
            panic!("obj")
        };
        let (_, key_span, value) = &entries[0];
        // Ключ починається РІВНО з `"a"`, не захоплює коментар вище.
        assert_eq!(&content[key_span.0..key_span.1], "\"a\"");
        let MNode::Scalar(_, value_span) = value else {
            panic!("scalar")
        };
        assert_eq!(&content[value_span.0..value_span.1], "1");
    }

    #[test]
    fn is_subset_object_missing_key_is_false() {
        let actual = Json::Object(vec![("a".to_string(), Json::Int(1))]);
        let snippet = Json::Object(vec![("b".to_string(), Json::Int(2))]);
        assert!(!is_subset(Some(&actual), &snippet));
    }

    #[test]
    fn is_subset_array_identity_update_keeps_structural_check_strict() {
        let actual = Json::Array(vec![Json::Object(vec![(
            "uses".to_string(),
            Json::Str("actions/checkout@v5".to_string()),
        )])]);
        let snippet = Json::Array(vec![Json::Object(vec![(
            "uses".to_string(),
            Json::Str("actions/checkout@v6".to_string()),
        )])]);
        // Різна версія — структурно НЕ той самий елемент (subset-check не
        // знає про identity-key, той самий контракт, що JS `checkSnippet`).
        assert!(!is_subset(Some(&actual), &snippet));
    }

    #[test]
    fn merge_json_value_updates_same_identity_element_in_place() {
        // `identity_key` перевіряє `name` РАНІШЕ `uses` (доккомент
        // `identity_key`, той самий пріоритет, що JS `identityKey`) — обидва
        // елементи тут БЕЗ `name`, тож збіг рахується за `uses` без версії.
        let actual = Json::Array(vec![Json::Object(vec![
            (
                "uses".to_string(),
                Json::Str("actions/checkout@v5".to_string()),
            ),
            (
                "with".to_string(),
                Json::Object(vec![("local-flag".to_string(), Json::Bool(true))]),
            ),
        ])]);
        let snippet = Json::Array(vec![Json::Object(vec![(
            "uses".to_string(),
            Json::Str("actions/checkout@v6".to_string()),
        )])]);
        let merged = merge_json_value(Some(&actual), &snippet);
        let Json::Array(items) = merged else {
            panic!("array")
        };
        assert_eq!(items.len(), 1, "оновлення on-place, не дублювання");
        assert_eq!(
            items[0].get("uses").and_then(Json::as_str),
            Some("actions/checkout@v6")
        );
        assert_eq!(
            items[0].get("with").and_then(|w| w.get("local-flag")),
            Some(&Json::Bool(true)),
            "локальне поле того самого елемента збережено"
        );
    }

    #[cfg(feature = "yaml")]
    #[test]
    fn write_yaml_block_round_trips_through_saphyr() {
        let value = Json::Object(vec![
            ("name".to_string(), Json::Str("with: colon".to_string())),
            (
                "steps".to_string(),
                Json::Array(vec![Json::Object(vec![
                    (
                        "uses".to_string(),
                        Json::Str("actions/checkout@v6".to_string()),
                    ),
                    (
                        "with".to_string(),
                        Json::Object(vec![("persist-credentials".to_string(), Json::Bool(false))]),
                    ),
                ])]),
            ),
        ]);
        let text = write_yaml_block(&value);
        let parsed = parse_yaml_document(&text).expect("write_yaml_block дає валідний YAML");
        assert_eq!(parsed, value);
    }

    #[cfg(feature = "yaml")]
    #[test]
    fn write_json_pretty_round_trips() {
        let value = Json::Object(vec![(
            "recommendations".to_string(),
            Json::Array(vec![Json::Str("a".to_string()), Json::Str("b".to_string())]),
        )]);
        let text = json_to_pretty_string(&value);
        assert!(text.ends_with('\n'));
        let parsed = parse_yaml_document(&text).expect("валідний JSON");
        assert_eq!(parsed, value);
    }

}
