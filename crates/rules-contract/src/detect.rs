//! `SourceFile`/`DetectBatch` — вхід lint-домену (`export detect`, WIT
//! `wit/world.wit`). Хост уже прочитав вміст файлів під час filesystem
//! scan-у (`rules_core::scan`, D1 фази 4а) — плагін не робить повторний IO
//! і не потребує `fs-read`-capability для типового концерну (спека §3.2).

use serde::{Deserialize, Serialize};

/// Один файл у батчі — точний структурний відповідник WIT `record source-file`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceFile {
    /// Posix-relative шлях від cwd.
    pub path: String,
    /// Повний вміст файлу.
    pub content: String,
}

/// Вхід `detect` — список файлів для конкретного заявленого концерну.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectBatch {
    /// Ідентифікатор концерну, для якого плагін викликається (плагін
    /// заявляє підтримувані концерни у `Manifest::concerns`).
    pub concern_id: String,
    pub files: Vec<SourceFile>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_batch_round_trips_through_json() {
        let batch = DetectBatch {
            concern_id: "sample/concern".to_string(),
            files: vec![SourceFile {
                path: "a/b.rs".to_string(),
                content: "fn main() {}".to_string(),
            }],
        };
        let json = serde_json::to_value(&batch).unwrap();
        let back: DetectBatch = serde_json::from_value(json).unwrap();
        assert_eq!(back.concern_id, "sample/concern");
        assert_eq!(back.files.len(), 1);
        assert_eq!(back.files[0].path, "a/b.rs");
    }
}
