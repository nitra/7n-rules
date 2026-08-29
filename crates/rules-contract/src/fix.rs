//! `FixRequest`/`FixPlan`/`FileEdit`/`WriteFile` — вхід/вихід lint-домену
//! (`export fix`, WIT `wit/world.wit`).
//!
//! # Бінарний вміст: `FileEdit::WriteBytes` (мажор `4.0.0`, §2.84)
//!
//! [`FileEdit::WriteBytes`] несе `Vec<u8>` — повний новий вміст файлу
//! БАЙТАМИ (WIT `write-bytes-file.content: list<u8>`). Це рівно та межа, де
//! `String`-варіант не працює: `WriteFile::content` — WIT `string`, тобто
//! валідний UTF-8, і фіксер стиснутого зображення просто не має чого туди
//! покласти (той самий аргумент, що вже документує
//! `crates/rules-napi::non_utf8_source_file_err` на detect-боці).
//!
//! **serde-репрезентація байтів — base64-РЯДОК, не масив чисел.** Це
//! свідома асиметрія з WIT: у канонічному ABI `list<u8>` — одна копія
//! байтів (base64 там коштував би +33% і зайвий декод у гості), а от у JSON
//! `Vec<u8>` серіалізувався б у `[137,80,78,71,…]` — на порядок більший
//! payload і безглузда форма для JS-споживача. Тому саме тут, на межі
//! napi→JS (`serde_json::to_value(plan)`), байти їдуть base64-рядком, а
//! `applyPlanEdit` (`npm/scripts/lib/lint-surface/run-fix.mjs`) робить
//! `Buffer.from(content, 'base64')`. Round-trip (`serialize` → `deserialize`)
//! лишається точним — регрес нижче.
//!
//! # Форма v3.0 — мінімум, не декларативний patch-формат
//!
//! T0Pattern-семантика (`npm/scripts/lib/lint-surface/run-detectors.mjs`) —
//! декларативний опис фіксів на боці JS-runner-а (find/replace-патерни,
//! collateral-veto навколо `data.line`) — **не** переїжджає у WIT цієї
//! задачі: вона лишається host-side логікою над списком [`Diagnostic`]-ів.
//! Натомість `export fix` у v3.0 повертає [`FixPlan`] — найпростішу
//! транспортабельну форму: список файлових операцій із **повним новим
//! вмістом** файлу ([`FileEdit::Write`]) або видаленням ([`FileEdit::Delete`]).
//! Частковий diff/patch-формат — свідомо поза контрактом і досі (кандидат
//! на НАСТУПНИЙ major `n-rules:plugin`, якщо розмір payload-у стане
//! проблемою для великих файлів із малими правками: форма `variant`-а —
//! рівно те, що не має width-subtyping, тож мінором його не додати).
//!
//! # Ці типи — спільні для wasm- І builtin-шляху (злиття дзеркала)
//!
//! Від fix-контуру contract v3 (host-виклик `export fix`) [`FixPlan`]/
//! [`FileEdit`]/[`WriteFile`] — єдине означення для обох шляхів:
//! `rules-core` (builtin T0-фікси, `crates/rules-core/src/concerns/fix.rs`)
//! реекспортує їх звідси замість колишнього структурного дзеркала — напрямок
//! залежності `rules-core` → `rules-contract` — саме той, що документує
//! `crate`-doc-коментар `lib.rs` («Залежність — лише в один бік»). Похідні
//! `PartialEq`/`Eq` додані задля цього злиття (порівняння планів у тестах
//! builtin-фіксів).
//!
//! План від wasm-плагіна — недовірений вхід: перед передачею оркестрації
//! хост валідує його ([`crate::validators::fix::validate_fix_plan`] —
//! safe-path + ліміти розміру).
//!
//! [`Diagnostic`]: crate::diagnostic::Diagnostic

use serde::{Deserialize, Serialize};

use crate::detect::SourceFile;
use crate::diagnostic::Diagnostic;

/// serde-міст `Vec<u8>` ⇄ base64-рядок для [`WriteBytesFile::content`]
/// (доккомент модуля, розділ «Бінарний вміст»). Окремий модуль, а не
/// зовнішній крейт-хелпер: залежність тут рівно одна (`base64`), і формат
/// межі мусить бути прочитаним у цьому ж файлі, де він документується.
mod base64_bytes {
    use base64::Engine as _;
    use serde::{Deserialize, Deserializer, Serializer};

    /// Стандартний алфавіт із padding-ом — те, що `Buffer.from(s,'base64')`
    /// у Node приймає без жодних опцій.
    const ENGINE: base64::engine::general_purpose::GeneralPurpose =
        base64::engine::general_purpose::STANDARD;

    pub(super) fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&ENGINE.encode(bytes))
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<u8>, D::Error> {
        let raw = String::deserialize(deserializer)?;
        ENGINE
            .decode(raw.as_bytes())
            .map_err(serde::de::Error::custom)
    }
}

/// Записати файл — повний новий вміст (точний відповідник WIT
/// `record write-file`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteFile {
    pub path: String,
    pub content: String,
}

/// Записати файл БІНАРНИМ вмістом — точний відповідник WIT
/// `record write-bytes-file` (мажор `4.0.0`, §2.84).
///
/// `content` серіалізується base64-РЯДКОМ (доккомент модуля): у WIT це
/// `list<u8>`, у JSON — рядок, і ця асиметрія свідома.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteBytesFile {
    pub path: String,
    #[serde(with = "base64_bytes")]
    pub content: Vec<u8>,
}

/// Одна файлова операція fix-plan-у — точний відповідник WIT
/// `variant file-edit`. serde-тег `type`
/// (`"write"`/`"delete"`/`"write-bytes"`) — явний discriminant, бо WIT
/// variant-и не серіалізуються в JSON автоматично (це вибір Rust-боку DTO,
/// не частина WIT ABI).
///
/// `WriteBytes` доданий мажором `4.0.0`; тег — kebab-case `"write-bytes"`,
/// дослівна назва WIT-case-а (`rename_all = "kebab-case"` лишає
/// `"write"`/`"delete"` без змін, тож наявні JSON-плани читаються як
/// раніше — регрес нижче).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum FileEdit {
    /// Записати файл (створити чи перезаписати) — повний новий вміст
    /// ТЕКСТОМ (валідний UTF-8).
    Write(WriteFile),
    /// Видалити файл за шляхом.
    Delete { path: String },
    /// Записати файл (створити чи перезаписати) — повний новий вміст
    /// БАЙТАМИ; на JSON-межі `content` — base64-рядок.
    WriteBytes(WriteBytesFile),
}

impl FileEdit {
    /// Шлях, якого стосується операція — спільний для всіх варіантів
    /// (`Write`/`Delete`/`WriteBytes`).
    ///
    /// Заведений разом із `WriteBytes` (мажор `4.0.0`, §2.84): доти кожен
    /// споживач, якому треба було лише «на який файл ця правка», писав
    /// власний вичерпний `match` — і новий case `variant`-а ламав їх усі
    /// підряд. Один акцесор робить додавання наступного case-а зміною в
    /// ОДНОМУ місці, а вичерпний `match` лишає там, де варіанти справді
    /// обробляються по-різному (застосування правки), а не перелічуються
    /// заради поля.
    pub fn path(&self) -> &str {
        match self {
            FileEdit::Write(write) => write.path.as_str(),
            FileEdit::Delete { path } => path.as_str(),
            FileEdit::WriteBytes(write) => write.path.as_str(),
        }
    }
}

/// Вхід `fix` — ті самі файли й концерн, що й `detect`, плюс діагностики,
/// для яких запитується fix (підмножина результату `detect`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixRequest {
    pub concern_id: String,
    pub files: Vec<SourceFile>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Результат `fix` — впорядкований список файлових операцій; порожній
/// список = «fix для цього запиту нічого не змінює».
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct FixPlan {
    pub edits: Vec<FileEdit>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Акцесор `path()` покриває ВСІ три варіанти — саме заради цього він
    /// і заведений (доккомент методу).
    #[test]
    fn path_accessor_covers_every_variant() {
        assert_eq!(
            FileEdit::Write(WriteFile {
                path: "a.txt".to_string(),
                content: String::new(),
            })
            .path(),
            "a.txt"
        );
        assert_eq!(
            FileEdit::Delete {
                path: "b.txt".to_string()
            }
            .path(),
            "b.txt"
        );
        assert_eq!(
            FileEdit::WriteBytes(WriteBytesFile {
                path: "c.png".to_string(),
                content: vec![],
            })
            .path(),
            "c.png"
        );
    }

    #[test]
    fn empty_fix_plan_means_no_changes() {
        let plan = FixPlan::default();
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn file_edit_write_round_trips_with_type_tag() {
        let edit = FileEdit::Write(WriteFile {
            path: "a.txt".to_string(),
            content: "нове".to_string(),
        });
        let json = serde_json::to_value(&edit).unwrap();
        assert_eq!(json["type"], "write");
        assert_eq!(json["path"], "a.txt");
        let back: FileEdit = serde_json::from_value(json).unwrap();
        match back {
            FileEdit::Write(w) => assert_eq!(w.content, "нове"),
            other => panic!("очікували write, отримали {other:?}"),
        }
    }

    /// Мажор `4.0.0`: байти на JSON-межі — base64-РЯДОК (не масив чисел),
    /// і round-trip точний. Обидві половини важливі: перша — контракт із
    /// `applyPlanEdit` (`Buffer.from(content,'base64')`), друга — доказ, що
    /// кодування нічого не втрачає на невалідних-як-UTF-8 байтах.
    #[test]
    fn write_bytes_edit_serializes_content_as_base64_string() {
        // PNG-сигнатура — байти, які НЕ є валідним UTF-8.
        let png_magic = vec![0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        let edit = FileEdit::WriteBytes(WriteBytesFile {
            path: "docs/logo.png".to_string(),
            content: png_magic.clone(),
        });
        let json = serde_json::to_value(&edit).unwrap();
        assert_eq!(json["type"], "write-bytes");
        assert_eq!(
            json["content"],
            serde_json::Value::String("iVBORw0KGgo=".to_string()),
            "байти мусять їхати base64-рядком, а не масивом чисел"
        );

        let back: FileEdit = serde_json::from_value(json).unwrap();
        match back {
            FileEdit::WriteBytes(w) => assert_eq!(w.content, png_magic),
            other => panic!("очікували write-bytes, отримали {other:?}"),
        }
    }

    /// Невалідний base64 від недовіреного джерела — типізована помилка
    /// десеріалізації, не паніка й не мовчазний порожній вміст.
    #[test]
    fn write_bytes_edit_rejects_broken_base64() {
        let raw = serde_json::json!({
            "type": "write-bytes",
            "path": "a.bin",
            "content": "не-base64!!",
        });
        assert!(serde_json::from_value::<FileEdit>(raw).is_err());
    }

    #[test]
    fn file_edit_delete_round_trips_with_type_tag() {
        let edit = FileEdit::Delete {
            path: "b.txt".to_string(),
        };
        let json = serde_json::to_value(&edit).unwrap();
        assert_eq!(json["type"], "delete");
        assert_eq!(json["path"], "b.txt");
    }
}
