//! wasm-компонент `n-rules:plugin@3.1.0` — `php/wasm-concerns`, ЧЕТВЕРТИЙ
//! first-party wasm-гість репозиторію (перший — `crates/plugin-lang-js`,
//! другий — `crates/plugin-lang-python`, третій — `crates/plugin-lang-rust`,
//! доккомент того `src/lib.rs` пояснює форму), створений за тим самим флоу
//! скіла `npm/skills/wasm-plugin/`. ОДНА хвиля порту: усі п'ять концернів
//! `plugins/lang-php/rules/php/*`, окрім `vscode_extensions` (T0-фіксер
//! без detector-а, поза обсягом) — на відміну від `rust`/`python`, `php` не
//! має окремого `applies`-концерна: реальний гейт застосовності —
//! декларативний `plugins/lang-php/rules/php/main.json` (`auto.glob`), тож
//! немає жодного context-pass концерна-заглушки для порту.
//!
//! - `php/tooling` (full-scope) — порт
//!   `plugins/lang-php/rules/php/tooling/main.mjs`: presence-перевірки
//!   кореня Composer-проєкту (`composer.json`/`package.json`), жодного
//!   читання вмісту ([`detect_tooling`]).
//! - `php/composer_manifest` (full-scope) — порт
//!   `plugins/lang-php/rules/php/composer_manifest/main.mjs`: канон
//!   кореневого `composer.json` — JSON-валідність, `config.sort-packages`,
//!   `license`, `require.php`, опційно `composer validate --strict`
//!   ([`detect_composer_manifest`]).
//! - `php/project` (full-scope, БЕЗ `lint.glob` у `concern.json`) — порт
//!   `plugins/lang-php/rules/php/project/main.mjs`: `composer audit` →
//!   `mago analyze` ([`detect_project`]).
//! - `php/mago_fmt`/`php/mago_lint` (per-file) — порт
//!   `plugins/lang-php/rules/php/mago_fmt/main.mjs` і
//!   `.../mago_lint/main.mjs`, обидва через спільну фабрику JS-канону
//!   (`plugins/lang-php/rules/php/lib/mago-per-file-detector.mjs`) —
//!   [`detect_mago_per_file`] тут той самий спільний нижній рівень,
//!   параметризований `magoArgs`/`reason`/`label`/`mdcName`, як і
//!   `createMagoPerFileDetector`.
//!
//! Жоден T0-фіксер не портований цією хвилею (`fixability: "config"` у трьох
//! `concern.json`) — [`Guest::fix`] повертає порожній план для КОЖНОГО
//! концерну, той самий контракт, що решта трьох гостей на своїй першій
//! хвилі.
//!
//! # `mago` — pinned, не `path:`
//!
//! JS-канон резолвить `composer` через `resolveCmd('composer')` (чисте
//! сканування `PATH`, той самий контур, що `resolveCmd('cargo')`
//! `rust/check`) — [`COMPOSER_TOOL`] = `"path:composer"`. `mago`, натомість,
//! резолвиться через `ensureToolAsync('mago')`
//! (`npm/scripts/lib/ensure-tool.mjs`) — managed github-release тул із
//! авто-встановленням і закріпленою версією, той самий контур, що
//! `conftest`/`opa`, а НЕ простий PATH-скан. Схема резолву `manifest.tools`
//! (`docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`, рішення В)
//! розрізняє це рядком БЕЗ префікса схеми — [`MAGO_TOOL`] = `"mago"` (bare
//! = pinned, дефолтна схема). `mago` уже в реєстрі `ensure-tool.mjs::TOOLS`
//! (задача, що готувала цю хвилю, звірила це незалежно — доккомент
//! завдання), тож жодного контрактного пробілу тут немає: хост забезпечує
//! наявність тула ОДИН раз для всього прогону (`ensureDeclaredTools`,
//! `npm/scripts/lib/lint-surface/wasm-plugins.mjs`), а гість лише спавнить
//! його через `exec-tool`, як і решта тулів. Це ПЕРШИЙ first-party
//! wasm-гість, що декларує pinned-тул (три попередні гості — виключно
//! `path:`).
//!
//! # Канал «`mago` недоступний» — задокументована розбіжність із каноном
//!
//! JS-канон (`php/project`, `php/mago_fmt`, `php/mago_lint`) НЕ має
//! окремого «`mago-missing`» violation-каналу: `ensureToolAsync` або
//! повертає шлях до бінарника (після мережевого встановлення за потреби),
//! або КИДАЄ виняток (`main-hard-fail.test.mjs`,
//! `plugins/lang-php/rules/php/mago_fmt/tests/main-hard-fail.test.mjs`,
//! перевірено незалежно, не здогад) — хост-оркестрація тоді провалює весь
//! `lint()`-виклик як помилку рантайму, не як звичайну діагностику. wasm-бік
//! структурно не може відтворити «кинути й провалити прогін»: контракт
//! `exec-tool` МАЄ повернути `ToolResult`, а не помилку виклику
//! (`crates/rules-contract/src/tool.rs`, доккомент `ToolResult::status`) —
//! незадекларований/нерезолвлений тул дає `status: none` із людиночитним
//! `stderr` (`ToolResolver::exec`,
//! `crates/rules-plugin-host/src/tool_resolver.rs`), той самий канал, що вже
//! прийнятий для КОЖНОГО tool-виклику решти трьох гостей («тул не
//! резолвиться» = `status: none`). Свідоме рішення цієї хвилі: `status:
//! none` виклику `mago` трактується як ЗВИЧАЙНЕ порушення тим самим
//! reason-ом, що non-zero exit код (`unwrap_or(1)`, той самий підхід, що
//! `crates/plugin-lang-rust::run_cargo_step`/
//! `crates/plugin-lang-python::detect_mypy` для СВОЇХ другого-і-далі
//! викликів уже резолвленого тула) — НЕ мовчазний skip (приховало б
//! реальну проблему від користувача) і НЕ нова, не-канонічна reason-назва
//! (вигадана поведінка, якої в JS немає). Ціна: текст `message` у цьому
//! вузькому каналі («`mago` взагалі недоступний») не збігається дослівно з
//! тим, що показав би JS-виняток (там взагалі не було б жодного
//! `LintResult`, лише впалий процес) — але reason (`mago-analyze` /
//! `mago-fmt-unformatted` / `mago-lint`) і сам факт «є діагностика» ті самі.
//!
//! # Розмір — НАЙЛЕГШИЙ з чотирьох гостей
//!
//! Жодної залежності, крім `wit-bindgen` (доккомент `Cargo.toml`): жоден
//! патерн п'яти концернів не потребує lookaround (`PHP_VERSION_RE` —
//! ПЕРШИЙ-матч без якоря, портований вручну, [`extract_php_version`]), і
//! жоден не читає TOML (усі маніфести цієї мови — `composer.json`, JSON).
//! JSON-парсинг `composer.json` — свій мінімальний парсер ([`JsonValue`]),
//! той самий мотив, що Blue Oak/pip-licenses парсер
//! `crates/plugin-lang-python/src/lib.rs`.
//!
//! # Трапи попередніх хвиль — перевірено явно
//!
//! 1. **`\w`/Unicode-класи regex.** Жоден патерн цього гостя НЕ portований
//!    у `regex`-крейт узагалі (крейта серед залежностей немає) — негативний
//!    результат перевірки задокументований тут явно, не мовчки. Єдиний
//!    патерн канону з `\d` (`PHP_VERSION_RE`, БЕЗ прапорця `u`) — ASCII-only
//!    і в JS, і в порту (`is_ascii_digit()`), нуль розбіжності.
//! 2. **Неуніформний ланцюжок тулів.** `php/project` — ДВА
//!    ранні-return-кроки (`composer` не резолвиться → return; `composer
//!    audit` провалюється → return) і ОДИН нефатальний (`mago analyze`
//!    провалюється → діагностика, але це вже останній крок, тому «не
//!    return» тут не спостережувано ззовні) — прочитано гілка за гілкою
//!    ([`detect_project`]), не скопійовано форму сусіднього гостя.
//! 3. **Тул резолвиться до проби доступності.** Жоден з п'яти концернів
//!    НЕ має окремого «проба доступності» кроку — `composer`/`mago`
//!    резолвляться і одразу виконуються В ОДНОМУ `exec-tool`-виклику (немає
//!    аналога `uvToolAvailable`), тож ця пастка тут структурно відсутня.
//! 4. **Вага залежностей.** Нуль нових крейтів понад `wit-bindgen`
//!    (доккомент вище) — вимірювання розміру нижче в звіті задачі.

wit_bindgen::generate!({
    path: "../rules-contract/wit",
    world: "plugin",
    generate_all,
});

/// Ключ контрибуції `php/tooling`.
const CONCERN_TOOLING: &str = "php/tooling";

/// Ключ контрибуції `php/composer_manifest`.
const CONCERN_COMPOSER_MANIFEST: &str = "php/composer_manifest";

/// Ключ контрибуції `php/project`.
const CONCERN_PROJECT: &str = "php/project";

/// Ключ контрибуції `php/mago_fmt`.
const CONCERN_MAGO_FMT: &str = "php/mago_fmt";

/// Ключ контрибуції `php/mago_lint`.
const CONCERN_MAGO_LINT: &str = "php/mago_lint";

/// Декларація тула `composer` — схема `path:` (доккомент модуля, розділ
/// «`mago` — pinned, не `path:`»): точний відповідник `resolveCmd('composer')`
/// JS-канону.
const COMPOSER_TOOL: &str = "path:composer";

/// Декларація тула `mago` — BARE (pinned/managed, дефолтна схема без
/// префікса): точний відповідник `ensureToolAsync('mago')` JS-канону
/// (доккомент модуля).
const MAGO_TOOL: &str = "mago";

/// Ліміт довжини вставки чужого stdout/stderr у повідомлення — точний
/// відповідник `.slice(0, 2000)`, ОДНАКОВИЙ у всіх трьох `main.mjs`, що його
/// використовують (`composer_manifest`, `project`,
/// `lib/mago-per-file-detector.mjs`).
const PHP_DETAIL_LIMIT: usize = 2000;

/// Шукає файл у батчі за точним posix-relative шляхом — batch-відповідник
/// `existsSync` JS-оригіналу (той самий helper, що в решти трьох гостей,
/// продубльований тут: крейти не діляться кодом через wasm-межу).
fn batch_file<'a>(files: &'a [SourceFile], path: &str) -> Option<&'a SourceFile> {
    files.iter().find(|f| f.path == path)
}

/// Діагностика форми `fail(msg, reason)` — точний відповідник
/// `createViolationReporter.fail`, коли викликач передає лише `reason`
/// (рядком, не об'єктом): `file`/`data` НЕ встановлюються (жоден із п'яти
/// `main.mjs` цього гостя ніколи не передає `opts.file`/`opts.data` —
/// перевірено читанням джерела, не здогад), `severity` завжди дефолтний
/// `error`.
fn plain_violation(reason: &str, message: String) -> Diagnostic {
    Diagnostic {
        reason: reason.to_string(),
        message,
        file: None,
        severity: Severity::Error,
        data: None,
    }
}

/// Обрізає рядок до `limit` СИМВОЛІВ (не байтів) — той самий helper, що в
/// решти трьох гостей (`truncate_chars`), наближення `String.prototype.slice`
/// JS-оригіналу (той рахує UTF-16 code units); вивід `composer`/`mago` —
/// здебільшого ASCII, де обидві міри збігаються.
fn truncate_chars(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        Some((index, _)) => text[..index].to_string(),
        None => text.to_string(),
    }
}

/// Формує суфікс повідомлення з чужого stdout+stderr — спільний хвіст, що
/// повторюється у ВСІХ трьох `exec-tool`-споживачах цього гостя
/// (`composer validate`, `composer audit`/`mago analyze`, `mago format`/
/// `mago lint`): конкатенація, `trim`, зріз до [`PHP_DETAIL_LIMIT`], з
/// провідним `\n` лише якщо непорожньо.
fn tool_output_suffix(stdout: &str, stderr: &str) -> String {
    let combined = format!("{stdout}{stderr}");
    let out = truncate_chars(combined.trim(), PHP_DETAIL_LIMIT);
    if out.is_empty() {
        String::new()
    } else {
        format!("\n{out}")
    }
}

// =====================================================================
// Мінімальний JSON-парсер — `composer.json` (доккомент модуля, розділ
// «Розмір»). Той самий мотив і та сама форма, що
// `crates/plugin-lang-python/src/lib.rs::JsonValue`/`JsonParser` (Blue Oak
// snapshot + pip-licenses spdx-json) — НЕ спільний код (крейти не діляться
// кодом через wasm-межу), окрема копія.
// =====================================================================

/// Мінімальне (без сторонніх крейтів) представлення JSON-значення — досить
/// generic, щоб коректно РОЗПІЗНАТИ (не лише вибірково прочитати) будь-який
/// валідний `composer.json`: `Number`/`Null`/`Bool` варіанти самі не читаються
/// продакшн-кодом ([`check_sort_packages`] читає лише `Bool`,
/// [`check_license`] — `Str`/`Array`, [`check_php_constraint`]/
/// [`extract_php_version`] — `Str`), АЛЕ мусять існувати, інакше парсер не
/// зможе коректно ПРОПУСТИТИ легітимні поля деінде в документі (`composer.json`
/// має чимало полів поза чотирма, що нас цікавлять) без хибного `Err`
/// («невалідний JSON» там, де JS `JSON.parse` пройшов би без проблем).
#[allow(dead_code)]
#[derive(Debug, Clone)]
enum JsonValue {
    Null,
    Bool(bool),
    Number(f64),
    Str(String),
    Array(Vec<JsonValue>),
    Object(Vec<(String, JsonValue)>),
}

impl JsonValue {
    /// `Some` лише для [`JsonValue::Str`] — той самий контракт, що
    /// властивість-доступ JS-канону, де тип, відмінний від рядка,
    /// трактується як «поля немає».
    fn as_str(&self) -> Option<&str> {
        match self {
            JsonValue::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    /// `Some` лише для [`JsonValue::Array`].
    fn as_array(&self) -> Option<&[JsonValue]> {
        match self {
            JsonValue::Array(items) => Some(items),
            _ => None,
        }
    }

    /// Пошук поля обʼєкта за іменем — `None` і для «немає такого ключа», і
    /// для «це не обʼєкт» (той самий контракт, що optional chaining `?.`
    /// JS-канону).
    fn get(&self, key: &str) -> Option<&JsonValue> {
        match self {
            JsonValue::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

/// Рекурсивно-спусковий парсер [`JsonValue`] по байтах UTF-8 рядка.
/// Повертає `Err` на будь-яку синтаксичну помилку — той самий канал, що
/// `try { JSON.parse(...) } catch { ... }` JS-канону; ТЕКСТ помилки НЕ
/// відтворює дослівно повідомлення V8 (`composer-manifest-invalid-json`,
/// доккомент [`detect_composer_manifest`]) — задокументована розбіжність,
/// не апроксимація мовчки.
struct JsonParser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> JsonParser<'a> {
    fn new(input: &'a str) -> Self {
        Self {
            bytes: input.as_bytes(),
            pos: 0,
        }
    }

    fn parse(mut self) -> Result<JsonValue, String> {
        self.skip_ws();
        let value = self.parse_value()?;
        self.skip_ws();
        if self.pos != self.bytes.len() {
            return Err("зайві символи після JSON-значення".to_string());
        }
        Ok(value)
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn parse_value(&mut self) -> Result<JsonValue, String> {
        self.skip_ws();
        match self.peek() {
            Some(b'"') => self.parse_string().map(JsonValue::Str),
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b't') => self.parse_literal("true", JsonValue::Bool(true)),
            Some(b'f') => self.parse_literal("false", JsonValue::Bool(false)),
            Some(b'n') => self.parse_literal("null", JsonValue::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.parse_number(),
            _ => Err("неочікуваний символ у JSON".to_string()),
        }
    }

    fn parse_literal(&mut self, lit: &str, value: JsonValue) -> Result<JsonValue, String> {
        let end = self.pos + lit.len();
        if self.bytes.get(self.pos..end) == Some(lit.as_bytes()) {
            self.pos = end;
            Ok(value)
        } else {
            Err(format!("очікував `{lit}`"))
        }
    }

    fn parse_number(&mut self) -> Result<JsonValue, String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit() || matches!(c, b'.' | b'e' | b'E' | b'+' | b'-'))
        {
            self.pos += 1;
        }
        let slice = std::str::from_utf8(&self.bytes[start..self.pos])
            .map_err(|_| "невалідний UTF-8 у числі".to_string())?;
        slice
            .parse::<f64>()
            .map(JsonValue::Number)
            .map_err(|_| "невалідне число".to_string())
    }

    fn parse_string(&mut self) -> Result<String, String> {
        // Викликається лише коли `self.peek() == Some(b'"')`.
        self.pos += 1;
        let mut out = String::new();
        loop {
            match self.peek() {
                None => return Err("незакритий рядок".to_string()),
                Some(b'"') => {
                    self.pos += 1;
                    break;
                }
                Some(b'\\') => {
                    self.pos += 1;
                    match self.peek() {
                        Some(b'"') => {
                            out.push('"');
                            self.pos += 1;
                        }
                        Some(b'\\') => {
                            out.push('\\');
                            self.pos += 1;
                        }
                        Some(b'/') => {
                            out.push('/');
                            self.pos += 1;
                        }
                        Some(b'b') => {
                            out.push('\u{8}');
                            self.pos += 1;
                        }
                        Some(b'f') => {
                            out.push('\u{c}');
                            self.pos += 1;
                        }
                        Some(b'n') => {
                            out.push('\n');
                            self.pos += 1;
                        }
                        Some(b'r') => {
                            out.push('\r');
                            self.pos += 1;
                        }
                        Some(b't') => {
                            out.push('\t');
                            self.pos += 1;
                        }
                        Some(b'u') => {
                            self.pos += 1;
                            let code = self.parse_hex4()?;
                            if (0xD800..=0xDBFF).contains(&code) {
                                if self.bytes.get(self.pos..self.pos + 2) == Some(b"\\u") {
                                    self.pos += 2;
                                    let low = self.parse_hex4()?;
                                    let combined = 0x10000u32
                                        + ((u32::from(code) - 0xD800) << 10)
                                        + (u32::from(low) - 0xDC00);
                                    out.push(
                                        char::from_u32(combined).ok_or_else(|| {
                                            "невалідна сурогатна пара".to_string()
                                        })?,
                                    );
                                } else {
                                    return Err("незавершена сурогатна пара".to_string());
                                }
                            } else {
                                out.push(
                                    char::from_u32(u32::from(code))
                                        .ok_or_else(|| "невалідний \\u-escape".to_string())?,
                                );
                            }
                        }
                        _ => return Err("невідомий escape-символ".to_string()),
                    }
                }
                Some(_) => {
                    let rest = std::str::from_utf8(&self.bytes[self.pos..])
                        .map_err(|_| "невалідний UTF-8".to_string())?;
                    let ch = rest
                        .chars()
                        .next()
                        .ok_or_else(|| "порожній залишок рядка".to_string())?;
                    out.push(ch);
                    self.pos += ch.len_utf8();
                }
            }
        }
        Ok(out)
    }

    fn parse_hex4(&mut self) -> Result<u16, String> {
        let slice = self
            .bytes
            .get(self.pos..self.pos + 4)
            .ok_or_else(|| "незавершений \\u-escape".to_string())?;
        let text =
            std::str::from_utf8(slice).map_err(|_| "невалідний UTF-8 у \\u-escape".to_string())?;
        let code =
            u16::from_str_radix(text, 16).map_err(|_| "невалідний hex у \\u-escape".to_string())?;
        self.pos += 4;
        Ok(code)
    }

    fn parse_array(&mut self) -> Result<JsonValue, String> {
        self.pos += 1; // `[`
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(JsonValue::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err("очікував `,` або `]`".to_string()),
            }
        }
        Ok(JsonValue::Array(items))
    }

    fn parse_object(&mut self) -> Result<JsonValue, String> {
        self.pos += 1; // `{`
        let mut entries = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(JsonValue::Object(entries));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err("очікував ключ-рядок".to_string());
            }
            let key = self.parse_string()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err("очікував `:`".to_string());
            }
            self.pos += 1;
            let value = self.parse_value()?;
            entries.push((key, value));
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    break;
                }
                _ => return Err("очікував `,` або `}`".to_string()),
            }
        }
        Ok(JsonValue::Object(entries))
    }
}

/// Розбирає `input` у [`JsonValue`] — точка входу для
/// [`detect_composer_manifest`]/[`read_php_version_constraint`].
fn parse_json(input: &str) -> Result<JsonValue, String> {
    JsonParser::new(input).parse()
}

// =====================================================================
// `php/tooling`
// =====================================================================

/// `reason` violation-ів `php/tooling` — точний відповідник `ctx.concernId`
/// (bare, БЕЗ префікса `ruleId/`): `fail(msg)` у `main.mjs` ніде не передає
/// другий аргумент, тож `createViolationReporter` підставляє
/// `defaultReason = ctx.concernId` (`'tooling'`, той самий контракт, що
/// `python/tooling`/`rust`-и, доккомент `violation-reporter.mjs`).
const TOOLING_REASON: &str = "tooling";

/// Точний порт `lint()` `php/tooling`
/// (`plugins/lang-php/rules/php/tooling/main.mjs`) — WHOLE-BATCH, суто
/// presence-перевірки кореня репо (host уже звузив `detect-batch.files` за
/// `ConcernContribution::glob`). Порядок діагностик — точний порядок гілок
/// JS-оригіналу.
fn detect_tooling(files: &[SourceFile]) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();

    if batch_file(files, "composer.json").is_none() {
        diagnostics.push(plain_violation(
            TOOLING_REASON,
            "composer.json не знайдено в корені — додай (php.mdc)".to_string(),
        ));
    }
    // `pass('composer.json існує')` — no-op, той самий контракт, що решта
    // `pass`-гілок цього гостя.

    if batch_file(files, "package.json").is_none() {
        diagnostics.push(plain_violation(
            TOOLING_REASON,
            "package.json не знайдено в корені — додай (php.mdc)".to_string(),
        ));
    }

    // Existence/структуру `lint-php.yml` вимагає провайдер-плагін
    // `@7n/rules-ci-github` — ядро провайдер-агностичне, той самий коментар,
    // що JS-оригінал.
    diagnostics
}

// =====================================================================
// `php/composer_manifest`
// =====================================================================

/// `reason` невалідного JSON — точний відповідник літерала
/// `'composer-manifest-invalid-json'` (`main.mjs`).
const COMPOSER_MANIFEST_INVALID_JSON_REASON: &str = "composer-manifest-invalid-json";

/// `reason` вимкненого `config.sort-packages`.
const COMPOSER_MANIFEST_SORT_PACKAGES_REASON: &str = "composer-manifest-sort-packages";

/// `reason` відсутнього/порожнього `license`.
const COMPOSER_MANIFEST_LICENSE_MISSING_REASON: &str = "composer-manifest-license-missing";

/// `reason` відсутнього явного `require.php`-constraint.
const COMPOSER_MANIFEST_PHP_CONSTRAINT_MISSING_REASON: &str =
    "composer-manifest-php-constraint-missing";

/// `reason` провалу `composer validate --strict --no-check-publish`.
const COMPOSER_MANIFEST_VALIDATE_FAILED_REASON: &str = "composer-manifest-validate-failed";

/// Значення `require.php`, що формально присутнє, але НЕ є явним
/// обмеженням версії — точний відповідник `NON_EXPLICIT_PHP_CONSTRAINTS`
/// (`main.mjs`, `Set(['*', ''])`).
fn is_non_explicit_php_constraint(trimmed: &str) -> bool {
    trimmed.is_empty() || trimmed == "*"
}

/// Точний порт `checkSortPackages` (`main.mjs`): `config.sort-packages`
/// мусить бути РІВНО `true` (не truthy).
fn check_sort_packages(manifest: &JsonValue, diagnostics: &mut Vec<Diagnostic>) {
    if matches!(
        manifest.get("config").and_then(|c| c.get("sort-packages")),
        Some(JsonValue::Bool(true))
    ) {
        return;
    }
    diagnostics.push(plain_violation(
        COMPOSER_MANIFEST_SORT_PACKAGES_REASON,
        "lint-php: composer.json — config.sort-packages не увімкнено; виконай `composer config sort-packages true` (composer_manifest.mdc)".to_string(),
    ));
}

/// Точний порт `checkLicense` (`main.mjs`): непорожній рядок АБО непорожній
/// масив (елементи масиву НЕ перевіряються — точний відповідник
/// `Array.isArray(license) && license.length > 0`).
fn check_license(manifest: &JsonValue, diagnostics: &mut Vec<Diagnostic>) {
    let license = manifest.get("license");
    let has_license = license
        .and_then(JsonValue::as_str)
        .is_some_and(|s| !s.trim().is_empty())
        || license
            .and_then(JsonValue::as_array)
            .is_some_and(|items| !items.is_empty());
    if has_license {
        return;
    }
    diagnostics.push(plain_violation(
        COMPOSER_MANIFEST_LICENSE_MISSING_REASON,
        "lint-php: composer.json — поле \"license\" відсутнє або порожнє; додай SPDX-ідентифікатор (наприклад \"MIT\" чи \"proprietary\") (composer_manifest.mdc)".to_string(),
    ));
}

/// Точний порт `checkPhpConstraint` (`main.mjs`): `require.php` мусить бути
/// непорожнім рядком поза [`is_non_explicit_php_constraint`].
fn check_php_constraint(manifest: &JsonValue, diagnostics: &mut Vec<Diagnostic>) {
    let constraint = manifest
        .get("require")
        .and_then(|r| r.get("php"))
        .and_then(JsonValue::as_str);
    if let Some(c) = constraint {
        let trimmed = c.trim();
        if !trimmed.is_empty() && !is_non_explicit_php_constraint(trimmed) {
            return;
        }
    }
    diagnostics.push(plain_violation(
        COMPOSER_MANIFEST_PHP_CONSTRAINT_MISSING_REASON,
        "lint-php: composer.json — \"require.php\" без явного version-constraint; додай, наприклад, `\"php\": \">=8.5\"` у секцію \"require\" (composer_manifest.mdc)".to_string(),
    ));
}

/// Точний порт `lint()` `php/composer_manifest`
/// (`plugins/lang-php/rules/php/composer_manifest/main.mjs`) — WHOLE-BATCH
/// (`concern.json.lint.glob: ["composer.json"]`). `composer.json` відсутній
/// у батчі → рання порожня відповідь (той самий `existsSync`-гейт, що
/// JS-оригінал).
fn detect_composer_manifest(files: &[SourceFile]) -> Vec<Diagnostic> {
    let Some(manifest_file) = batch_file(files, "composer.json") else {
        return Vec::new();
    };

    let manifest = match parse_json(&manifest_file.content) {
        Ok(v) => v,
        Err(detail) => {
            return vec![plain_violation(
                COMPOSER_MANIFEST_INVALID_JSON_REASON,
                format!(
                    "lint-php: composer.json — невалідний JSON ({detail}); виправ синтаксис (composer_manifest.mdc)"
                ),
            )];
        }
    };

    let mut diagnostics = Vec::new();
    check_sort_packages(&manifest, &mut diagnostics);
    check_license(&manifest, &mut diagnostics);
    check_php_constraint(&manifest, &mut diagnostics);

    // `composer` резолвиться і спавниться в ОДНОМУ `exec-tool`-виклику —
    // `status: none` тут СИЛЕНТНИЙ skip (точний відповідник `if (composer)
    // {...}` JS-оригіналу — БЕЗ `else`-гілки: composer-missing репортить
    // ЛИШЕ `php/project`, доккомент JS-джерела).
    let validate_result = exec_tool(&ToolRequest {
        tool: COMPOSER_TOOL.to_string(),
        args: vec![
            "validate".to_string(),
            "--strict".to_string(),
            "--no-check-publish".to_string(),
        ],
        stdin: None,
        // `None` — корінь репо, рівно `cwd: root` (`ctx.cwd`) JS-оригіналу.
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    if let Some(code) = validate_result.status {
        if code != 0 {
            let suffix = tool_output_suffix(&validate_result.stdout, &validate_result.stderr);
            diagnostics.push(plain_violation(
                COMPOSER_MANIFEST_VALIDATE_FAILED_REASON,
                format!(
                    "lint-php: composer validate --strict — помилка (код {code}, composer_manifest.mdc){suffix}"
                ),
            ));
        }
    }

    diagnostics
}

// =====================================================================
// `php/project`
// =====================================================================

/// `reason` «`composer` не резолвиться» — точний відповідник `fail(msg,
/// 'composer-missing')` (`main.mjs`).
const PROJECT_COMPOSER_MISSING_REASON: &str = "composer-missing";

/// Повідомлення «`composer` не знайдено» — точний відповідник рядкового
/// літерала `main.mjs`.
const PROJECT_COMPOSER_MISSING_MESSAGE: &str =
    "lint-php: `composer` не знайдено в PATH (потрібен при наявному composer.json, php.mdc)";

/// `reason` провалу `composer audit --no-interaction`.
const PROJECT_COMPOSER_AUDIT_VIOLATION_REASON: &str = "composer-audit-violation";

/// `reason` провалу `mago analyze` — той самий reason, що [`Guest::detect`]
/// повертає й на структурно неможливий канал «`mago` недоступний» (доккомент
/// модуля, розділ «Канал „`mago` недоступний“»).
const PROJECT_MAGO_ANALYZE_REASON: &str = "mago-analyze";

/// Перший `X.Y`-патерн у composer-constraint (`">=8.2"`, `"^8.2"`, `"~8.2.0"`,
/// `"8.2.*"`) — точний функціональний порт `PHP_VERSION_RE = /(\d{1,4})\.(\d{1,4})/`
/// БЕЗ regex-крейта (доккомент модуля, розділ «Розмір»): JS `\d` без
/// прапорця `u` — ASCII-only, `u8::is_ascii_digit()` — точний відповідник,
/// нуль Unicode-розбіжності (на відміну від `\w` у `rust/doc_comments`/
/// `python/doc_comments`, тут її взагалі нема).
///
/// Емулює regex-семантику «перший матч, group1 `{1,4}` ЖАДІБНИЙ із
/// backtrack»: для кожної стартової позиції з цифрою перебирає довжину
/// group1 від максимальної (до 4 цифр, скільки є) до 1, шукаючи літеральну
/// `.` одразу після — перший успіх повертається; group2 — жадібно до 4 цифр
/// одразу після `.` (нічого далі не вимагається, backtrack не потрібен).
/// Перевірено юніт-тестами проти ВСІХ прикладів `plugins/lang-php/rules/php/
/// project/tests/main.test.mjs::extractPhpVersion` ([`tests::extract_php_version_matches_js_examples`]).
fn extract_php_version(constraint: &str) -> Option<(String, String)> {
    let bytes = constraint.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let mut run_end = i;
        while run_end < len && bytes[run_end].is_ascii_digit() && run_end - i < 4 {
            run_end += 1;
        }
        let max_len1 = run_end - i;
        for len1 in (1..=max_len1).rev() {
            let dot_pos = i + len1;
            if dot_pos >= len || bytes[dot_pos] != b'.' {
                continue;
            }
            let start2 = dot_pos + 1;
            let mut end2 = start2;
            while end2 < len && bytes[end2].is_ascii_digit() && end2 - start2 < 4 {
                end2 += 1;
            }
            if end2 > start2 {
                return Some((
                    constraint[i..i + len1].to_string(),
                    constraint[start2..end2].to_string(),
                ));
            }
        }
        i += 1;
    }
    None
}

/// Читає `require.php` з уже наданого host-ом вмісту `composer.json` і
/// витягує мінімальну PHP-версію — точний порт `readPhpVersionConstraint`
/// (`main.mjs`): будь-яка помилка (невалідний JSON, відсутнє поле, поле не
/// рядок) тихо дає `None` — той самий catch-null-fallback JS-оригіналу
/// (`mago analyze` тоді запускається без `--php-version`, дефолт
/// `mago`/`mago.toml`).
fn read_php_version_constraint(composer_json_content: &str) -> Option<String> {
    let manifest = parse_json(composer_json_content).ok()?;
    let constraint = manifest
        .get("require")
        .and_then(|r| r.get("php"))
        .and_then(JsonValue::as_str)?;
    let (major, minor) = extract_php_version(constraint)?;
    Some(format!("{major}.{minor}"))
}

/// Точний порт `lint()` `php/project`
/// (`plugins/lang-php/rules/php/project/main.mjs`) — WHOLE-BATCH, глоб
/// контрибуції звужений до `composer.json` (доккомент `plugin.toml`).
/// НЕ-уніформний ланцюжок: `composer` не резолвиться → RETURN; `composer
/// audit` провалюється → RETURN; `mago analyze` провалюється → діагностика
/// (останній крок, «продовжити» тут не спостережувано — нема наступного
/// кроку, доккомент модуля, розділ «Трапи», п.2).
fn detect_project(files: &[SourceFile]) -> Vec<Diagnostic> {
    let Some(manifest_file) = batch_file(files, "composer.json") else {
        return Vec::new();
    };

    let audit_result = exec_tool(&ToolRequest {
        tool: COMPOSER_TOOL.to_string(),
        args: vec!["audit".to_string(), "--no-interaction".to_string()],
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    let Some(audit_code) = audit_result.status else {
        return vec![plain_violation(
            PROJECT_COMPOSER_MISSING_REASON,
            PROJECT_COMPOSER_MISSING_MESSAGE.to_string(),
        )];
    };
    if audit_code != 0 {
        let suffix = tool_output_suffix(&audit_result.stdout, &audit_result.stderr);
        return vec![plain_violation(
            PROJECT_COMPOSER_AUDIT_VIOLATION_REASON,
            format!("lint-php: composer audit — помилка (код {audit_code}, php.mdc){suffix}"),
        )];
    }

    let php_version = read_php_version_constraint(&manifest_file.content);
    let mut mago_args = Vec::new();
    if let Some(version) = &php_version {
        mago_args.push("--php-version".to_string());
        mago_args.push(version.clone());
    }
    mago_args.push("analyze".to_string());

    let analyze_result = exec_tool(&ToolRequest {
        tool: MAGO_TOOL.to_string(),
        args: mago_args,
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    // `status: none` (доккомент модуля, розділ «Канал „`mago` недоступний“»)
    // трактується як звичайна відмова з кодом 1 — той самий підхід, що
    // другий-і-далі `exec-tool`-виклики вже резолвленого тула в решти трьох
    // гостей.
    let code = analyze_result.status.unwrap_or(1);
    if code == 0 {
        return Vec::new();
    }
    let suffix = tool_output_suffix(&analyze_result.stdout, &analyze_result.stderr);
    vec![plain_violation(
        PROJECT_MAGO_ANALYZE_REASON,
        format!("lint-php: mago analyze — помилка (код {code}, php.mdc){suffix}"),
    )]
}

// =====================================================================
// `php/mago_fmt` + `php/mago_lint` — спільний нижній рівень, точний порт
// `createMagoPerFileDetector`
// (`plugins/lang-php/rules/php/lib/mago-per-file-detector.mjs`).
// =====================================================================

/// `reason` `php/mago_fmt` — точний відповідник `reason: 'mago-fmt-unformatted'`
/// (`mago_fmt/main.mjs`, аргумент фабрики).
const MAGO_FMT_REASON: &str = "mago-fmt-unformatted";

/// Людський опис кроку `php/mago_fmt` — точний відповідник `label`
/// (`mago_fmt/main.mjs`).
const MAGO_FMT_LABEL: &str = "mago format (dry-run) — потрібне форматування";

/// Ім'я `.mdc`-файлу `php/mago_fmt` для посилання в повідомленні.
const MAGO_FMT_MDC_NAME: &str = "mago_fmt.mdc";

/// `reason` `php/mago_lint`.
const MAGO_LINT_REASON: &str = "mago-lint";

/// Людський опис кроку `php/mago_lint`.
const MAGO_LINT_LABEL: &str = "mago lint — знайдено порушення";

/// Ім'я `.mdc`-файлу `php/mago_lint`.
const MAGO_LINT_MDC_NAME: &str = "mago_lint.mdc";

/// Точний функціональний порт `createMagoPerFileDetector`
/// (`mago-per-file-detector.mjs`) — параметризований `mago_args`/`reason`/
/// `label`/`mdc_name`, як і JS-фабрика.
///
/// `targets` — `.php`-файли вже наданого host-ом батчу. JS-оригінал має
/// фолбек `ctx.files === undefined ? ['.'] : ...` (весь проєкт одним
/// аргументом `.` — режим `lint --full` без делти), АЛЕ цей канал
/// НЕДОСЯЖНИЙ у wasm-гостя: хост ЗАВЖДИ передає конкретний список файлів
/// (per-file batch за `ConcernContribution::glob`, і в дельта-, і в
/// full-режимі), той самий висновок, що вже задокументований для
/// `python/mypy`/`python/ruff` (`crates/plugin-lang-python/src/lib.rs`,
/// розділ «Per-file + якорі», параграф `prepare_python_run`).
///
/// `composer.json`-гейт per-file batch-у (`**/*.php`) не несе — його
/// приносить `lint.anchors` відповідного `concern.json`
/// (`["composer.json"]`, доданий цією ж задачею до `mago_fmt`/`mago_lint`,
/// той самий крок, що зробила хвиля `python/mypy`+`python/ruff` для
/// `pyproject.toml`).
fn detect_mago_per_file(
    files: &[SourceFile],
    mago_args: &[&str],
    reason: &str,
    label: &str,
    mdc_name: &str,
) -> Vec<Diagnostic> {
    if batch_file(files, "composer.json").is_none() {
        return Vec::new();
    }

    let targets: Vec<String> = files
        .iter()
        .filter(|f| f.path.ends_with(".php"))
        .map(|f| f.path.clone())
        .collect();
    if targets.is_empty() {
        return Vec::new();
    }

    let mut args: Vec<String> = mago_args.iter().map(|s| s.to_string()).collect();
    args.extend(targets);

    let result = exec_tool(&ToolRequest {
        tool: MAGO_TOOL.to_string(),
        args,
        stdin: None,
        cwd: None,
        env: vec![],
        scratch_in: vec![],
        scratch_out: vec![],
    });
    // `status: none` — той самий підхід, що [`detect_project`] (доккомент
    // модуля, розділ «Канал „`mago` недоступний“»).
    let code = result.status.unwrap_or(1);
    if code == 0 {
        return Vec::new();
    }
    let suffix = tool_output_suffix(&result.stdout, &result.stderr);
    vec![plain_violation(
        reason,
        format!("lint-php: {label} (код {code}, {mdc_name}){suffix}"),
    )]
}

/// Точний порт `lint()` `php/mago_fmt`
/// (`plugins/lang-php/rules/php/mago_fmt/main.mjs`).
fn detect_mago_fmt(files: &[SourceFile]) -> Vec<Diagnostic> {
    detect_mago_per_file(
        files,
        &["format", "--dry-run"],
        MAGO_FMT_REASON,
        MAGO_FMT_LABEL,
        MAGO_FMT_MDC_NAME,
    )
}

/// Точний порт `lint()` `php/mago_lint`
/// (`plugins/lang-php/rules/php/mago_lint/main.mjs`).
fn detect_mago_lint(files: &[SourceFile]) -> Vec<Diagnostic> {
    detect_mago_per_file(
        files,
        &["lint"],
        MAGO_LINT_REASON,
        MAGO_LINT_LABEL,
        MAGO_LINT_MDC_NAME,
    )
}

/// Чиста (без host-імпортів `log`/`report-progress`) конструктор
/// маніфеста — винесений з [`Guest::describe`] окремо, щоб host-таргет
/// unit-тести могли звірити форму маніфеста без реального wasmtime-хоста
/// (той самий мотив, що решта трьох гостей).
fn build_manifest() -> Manifest {
    Manifest {
        id: "php/wasm-concerns".to_string(),
        version: "0.1.0".to_string(),
        world_version: "3.1.0".to_string(),
        domains: vec![Domain::Lint],
        concerns: vec![
            ConcernContribution {
                key: CONCERN_TOOLING.to_string(),
                scope: ConcernScope::Full,
                glob: vec![
                    "composer.json".to_string(),
                    "package.json".to_string(),
                    ".github/workflows/lint-php.yml".to_string(),
                ],
            },
            ConcernContribution {
                key: CONCERN_COMPOSER_MANIFEST.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["composer.json".to_string()],
            },
            // `concern.json` цього концерну не декларує `lint.glob` узагалі
            // — глоб контрибуції звужений до ОДНОГО presence-сигналу, той
            // самий свідомий вибір, що `python/project`/`bun/licensee`
            // (доккомент `plugin.toml`).
            ConcernContribution {
                key: CONCERN_PROJECT.to_string(),
                scope: ConcernScope::Full,
                glob: vec!["composer.json".to_string()],
            },
            // `composer.json` до per-file DELTA-batch-у приносить
            // `lint.anchors`, НЕ цей glob (доккомент [`detect_mago_per_file`]).
            // Але у FULL-прогоні (`--full`, `files: None`) якорів немає —
            // batch будує хост РІВНО з цього glob-а
            // (`crates/rules-napi::build_detect_batch_files`, §2.65), тож
            // `composer.json` тут ЯВНО: без нього
            // [`detect_mago_per_file`]-guard (`batch_file(files,
            // "composer.json").is_none()`) у `--full` мовчки повертав би
            // порожньо на будь-якому PHP-проєкті.
            ConcernContribution {
                key: CONCERN_MAGO_FMT.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.php".to_string(), "composer.json".to_string()],
            },
            ConcernContribution {
                key: CONCERN_MAGO_LINT.to_string(),
                scope: ConcernScope::PerFile,
                glob: vec!["**/*.php".to_string(), "composer.json".to_string()],
            },
        ],
        ci_artifacts: vec![],
        // Вміст файлів хост передає inline (per-file чи host-побудований
        // full-scope batch) — плагін не читає диск сам (той самий мотив, що
        // решта трьох гостей).
        capabilities: Capabilities {
            fs_read: vec![],
            network: false,
        },
        tools: vec![COMPOSER_TOOL.to_string(), MAGO_TOOL.to_string()],
    }
}

/// Guest-реалізація `n-rules:plugin@3.1.0` для `php/wasm-concerns` — п'ять
/// концернів однієї хвилі (доккомент модуля).
struct LangPhp;

impl Guest for LangPhp {
    fn describe() -> Manifest {
        log(LogLevel::Info, "plugin-lang-php: describe()");
        build_manifest()
    }

    fn detect(batch: DetectBatch) -> Vec<Diagnostic> {
        let total = batch.files.len() as u32;
        let diagnostics = match batch.concern_id.as_str() {
            CONCERN_TOOLING => {
                report_progress(total, total);
                detect_tooling(&batch.files)
            }
            CONCERN_COMPOSER_MANIFEST => {
                report_progress(total, total);
                detect_composer_manifest(&batch.files)
            }
            CONCERN_PROJECT => {
                report_progress(total, total);
                detect_project(&batch.files)
            }
            // PerFile, АЛЕ весь переданий batch ОДНИМ викликом (НЕ по
            // одному файлу за раз) — JS-канон спавнить `mago` РІВНО ОДИН
            // раз із усіма цілями як аргументами, той самий мотив, що
            // `CONCERN_MYPY`/`CONCERN_RUFF` у
            // `crates/plugin-lang-python/src/lib.rs`.
            CONCERN_MAGO_FMT => {
                report_progress(total, total);
                detect_mago_fmt(&batch.files)
            }
            CONCERN_MAGO_LINT => {
                report_progress(total, total);
                detect_mago_lint(&batch.files)
            }
            _ => Vec::new(),
        };
        log(
            LogLevel::Info,
            &format!(
                "plugin-lang-php: detect({}) опрацював {total} файл(ів)",
                batch.concern_id
            ),
        );
        diagnostics
    }

    /// Жоден T0-фіксер не портований цією хвилею (доккомент модуля) —
    /// порожній план для КОЖНОГО концерну, та сама сумісна заглушка, що в
    /// решти трьох гостей на своїй першій хвилі.
    fn fix(_request: FixRequest) -> FixPlan {
        FixPlan { edits: vec![] }
    }

    fn ecosystem_outdated(_request: EcosystemRequest) -> Result<Vec<OutdatedDep>, DomainError> {
        Err(DomainError::NotSupported)
    }

    fn docgen_render(_request: DocgenRequest) -> Result<DocOutput, DomainError> {
        Err(DomainError::NotSupported)
    }
}

export!(LangPhp);

#[cfg(test)]
mod tests {
    //! Юніт-тести на host-таргеті (`cargo test -p plugin-lang-php`, без
    //! wasm-збірки) — лише чисті helper-и, НЕ `Guest::describe`/`detect`
    //! (той самий обсяг, що юніт-секції решти трьох гостей): біт-у-біт
    //! parity з JS-каноном на фікстурах живе в
    //! `npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-php.test.mjs`
    //! (реальний wasmtime-хост).
    use super::*;

    fn sf(path: &str, content: &str) -> SourceFile {
        SourceFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    // --- extract_php_version — точні приклади `extractPhpVersion` JS-тесту
    // (`plugins/lang-php/rules/php/project/tests/main.test.mjs`) ---

    #[test]
    fn extract_php_version_matches_js_examples() {
        assert_eq!(
            extract_php_version(">=8.2"),
            Some(("8".to_string(), "2".to_string()))
        );
        assert_eq!(
            extract_php_version("^8.2"),
            Some(("8".to_string(), "2".to_string()))
        );
        assert_eq!(
            extract_php_version("~8.2.0"),
            Some(("8".to_string(), "2".to_string()))
        );
        assert_eq!(
            extract_php_version("8.2.*"),
            Some(("8".to_string(), "2".to_string()))
        );
        assert_eq!(
            extract_php_version("8.1 || 8.2"),
            Some(("8".to_string(), "1".to_string()))
        );
        assert_eq!(extract_php_version("*"), None);
        assert_eq!(extract_php_version(""), None);
    }

    #[test]
    fn read_php_version_constraint_missing_field_is_none() {
        assert_eq!(read_php_version_constraint(r#"{"name":"x"}"#), None);
    }

    #[test]
    fn read_php_version_constraint_invalid_json_is_none() {
        assert_eq!(read_php_version_constraint("{ not valid json"), None);
    }

    #[test]
    fn read_php_version_constraint_extracts_major_minor() {
        assert_eq!(
            read_php_version_constraint(r#"{"require":{"php":">=8.2"}}"#),
            Some("8.2".to_string())
        );
    }

    // --- JSON-парсер: округла перевірка на generic-документі ---

    #[test]
    fn parse_json_reads_nested_object_array_and_escapes() {
        let value = parse_json(r#"{"a":[1,2.5,true,false,null,"x\"y\n"],"b":{"c":"d"}}"#)
            .expect("валідний JSON");
        let a = value.get("a").and_then(JsonValue::as_array).expect("масив");
        assert_eq!(a.len(), 6);
        assert!(matches!(a[5], JsonValue::Str(ref s) if s == "x\"y\n"));
        assert_eq!(
            value
                .get("b")
                .and_then(|b| b.get("c"))
                .and_then(JsonValue::as_str),
            Some("d")
        );
    }

    #[test]
    fn parse_json_rejects_trailing_garbage() {
        assert!(parse_json(r#"{"a":1} garbage"#).is_err());
    }

    #[test]
    fn parse_json_rejects_truncated_input() {
        assert!(parse_json(r#"{ "name": "nitra/demo", "#).is_err());
    }

    // --- php/tooling ---

    #[test]
    fn detect_tooling_both_manifests_present_is_clean() {
        let files = vec![sf("composer.json", "{}"), sf("package.json", "{}")];
        assert!(detect_tooling(&files).is_empty());
    }

    #[test]
    fn detect_tooling_missing_both_reports_two_violations_with_bare_reason() {
        let violations = detect_tooling(&[]);
        assert_eq!(violations.len(), 2);
        assert!(violations.iter().all(|v| v.reason == TOOLING_REASON));
    }

    // --- php/composer_manifest ---

    const CANON_MANIFEST: &str = r#"{"name":"nitra/demo","license":"MIT","require":{"php":">=8.5"},"config":{"sort-packages":true}}"#;

    #[test]
    fn detect_composer_manifest_missing_file_is_empty() {
        assert!(detect_composer_manifest(&[]).is_empty());
    }

    #[test]
    fn detect_composer_manifest_invalid_json_short_circuits() {
        let files = vec![sf("composer.json", "{ not valid")];
        let violations = detect_composer_manifest(&files);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].reason, COMPOSER_MANIFEST_INVALID_JSON_REASON);
    }

    // `detect_composer_manifest` ЗАВЖДИ доходить до `exec_tool` (`composer
    // validate`), коли `composer.json` присутній і парситься — виклик
    // host-функції `exec-tool` поза реальним wasmtime-хостом абортує
    // процес (`unreachable!()` у згенерованому wit-import, перевірено
    // емпірично: перша версія цих тестів валила host-таргет прогін
    // SIGABRT-ом), той самий мотив, чому `crates/plugin-lang-python/src/lib.rs`
    // ніде не викликає `detect_project`/`detect_mypy`/`detect_ruff` (усі
    // теж безумовно доходять до `exec_tool`) зі свого `#[cfg(test)]`-модуля.
    // Три декларативні перевірки [`check_sort_packages`]/[`check_license`]/
    // [`check_php_constraint`] тестуються тут НАПРЯМУ (чисті функції, без
    // `exec_tool`); `exec_tool`-гілку (`composer validate`) і композицію
    // всіх чотирьох перевірок в одному прогоні `detect_composer_manifest`
    // покриває parity-тест на реальному wasmtime-хості
    // (`wasm-plugin-parity-php.test.mjs`).

    #[test]
    fn check_sort_packages_true_is_clean() {
        let manifest = parse_json(CANON_MANIFEST).expect("валідний JSON");
        let mut diagnostics = Vec::new();
        check_sort_packages(&manifest, &mut diagnostics);
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn check_sort_packages_missing_config_reports_violation() {
        let manifest = parse_json(r#"{"name":"nitra/demo"}"#).expect("валідний JSON");
        let mut diagnostics = Vec::new();
        check_sort_packages(&manifest, &mut diagnostics);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].reason,
            COMPOSER_MANIFEST_SORT_PACKAGES_REASON
        );
    }

    #[test]
    fn check_license_string_is_clean() {
        let manifest = parse_json(CANON_MANIFEST).expect("валідний JSON");
        let mut diagnostics = Vec::new();
        check_license(&manifest, &mut diagnostics);
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn check_license_non_empty_array_is_clean() {
        let manifest = parse_json(r#"{"license":["MIT","Apache-2.0"]}"#).expect("валідний JSON");
        let mut diagnostics = Vec::new();
        check_license(&manifest, &mut diagnostics);
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn check_license_missing_reports_violation() {
        let manifest = parse_json(r#"{"name":"nitra/demo"}"#).expect("валідний JSON");
        let mut diagnostics = Vec::new();
        check_license(&manifest, &mut diagnostics);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].reason,
            COMPOSER_MANIFEST_LICENSE_MISSING_REASON
        );
    }

    #[test]
    fn check_php_constraint_star_is_not_explicit() {
        let manifest = parse_json(r#"{"require":{"php":"*"}}"#).expect("валідний JSON");
        let mut diagnostics = Vec::new();
        check_php_constraint(&manifest, &mut diagnostics);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].reason,
            COMPOSER_MANIFEST_PHP_CONSTRAINT_MISSING_REASON
        );
    }

    #[test]
    fn check_php_constraint_explicit_version_is_clean() {
        let manifest = parse_json(CANON_MANIFEST).expect("валідний JSON");
        let mut diagnostics = Vec::new();
        check_php_constraint(&manifest, &mut diagnostics);
        assert!(diagnostics.is_empty());
    }

    // --- php/project ---

    #[test]
    fn detect_project_missing_composer_json_is_empty() {
        assert!(detect_project(&[]).is_empty());
    }

    // --- php/mago_fmt + php/mago_lint (спільний нижній рівень) ---

    #[test]
    fn detect_mago_per_file_missing_composer_json_is_empty() {
        let files = vec![sf("src/a.php", "<?php\n")];
        assert!(detect_mago_fmt(&files).is_empty());
        assert!(detect_mago_lint(&files).is_empty());
    }

    #[test]
    fn detect_mago_per_file_no_php_targets_is_empty() {
        let files = vec![sf("composer.json", "{}"), sf("README.md", "# demo\n")];
        assert!(detect_mago_fmt(&files).is_empty());
        assert!(detect_mago_lint(&files).is_empty());
    }

    // --- маніфест: anti-drift `plugin.toml` ---

    #[test]
    fn build_manifest_declares_all_concerns_with_expected_scopes() {
        let manifest = build_manifest();
        assert_eq!(manifest.id, "php/wasm-concerns");
        assert_eq!(manifest.concerns.len(), 5);

        let by_key = |key: &str| {
            manifest
                .concerns
                .iter()
                .find(|c| c.key == key)
                .unwrap_or_else(|| panic!("concern {key} відсутній у build_manifest()"))
        };
        assert_eq!(by_key(CONCERN_TOOLING).scope, ConcernScope::Full);
        assert_eq!(by_key(CONCERN_COMPOSER_MANIFEST).scope, ConcernScope::Full);
        assert_eq!(by_key(CONCERN_PROJECT).scope, ConcernScope::Full);
        assert_eq!(by_key(CONCERN_MAGO_FMT).scope, ConcernScope::PerFile);
        assert_eq!(by_key(CONCERN_MAGO_LINT).scope, ConcernScope::PerFile);

        assert_eq!(
            manifest.tools,
            vec![COMPOSER_TOOL.to_string(), MAGO_TOOL.to_string()]
        );
    }

    #[test]
    fn plugin_toml_concern_keys_match_describe() {
        let manifest: toml::Table = include_str!("../plugin.toml")
            .parse()
            .expect("plugin.toml має бути валідним TOML");
        let runtime = build_manifest();

        let mut declared: Vec<&str> = manifest
            .get("concerns")
            .and_then(|v| v.as_array())
            .expect("`concerns` — array of tables у корені маніфеста")
            .iter()
            .map(|c| c["key"].as_str().expect("`key` — рядок"))
            .collect();
        declared.sort_unstable();
        let mut runtime_keys: Vec<&str> = runtime.concerns.iter().map(|c| c.key.as_str()).collect();
        runtime_keys.sort_unstable();
        assert_eq!(
            declared, runtime_keys,
            "plugin.toml розійшовся з describe() по concerns — синхронізуй маніфест-довідник"
        );

        let declared_tools: Vec<&str> = manifest
            .get("tools")
            .and_then(|v| v.as_array())
            .expect("`tools` мусить бути top-level масивом маніфеста")
            .iter()
            .map(|t| t.as_str().expect("елемент `tools` — рядок"))
            .collect();
        assert_eq!(
            declared_tools,
            runtime.tools.iter().map(String::as_str).collect::<Vec<_>>(),
            "plugin.toml розійшовся з describe() по tools"
        );
    }
}
