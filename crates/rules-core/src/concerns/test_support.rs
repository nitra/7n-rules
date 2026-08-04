//! Спільні тест-хелпери concern-модулів.
//!
//! До цього модуля кожен `#[cfg(test)] mod tests` мав власну байт-у-байт копію
//! `fn write(&TempDir, rel, content)`. 28 копій однакової преамбули давали
//! jscpd-клони ≥25 рядків між парами concern-файлів (гейт `Lint repo-wide`,
//! `js/jscpd_duplicates`) — клон був не «випадковою схожістю», а реальним
//! копіюванням хелпера, тож правильна відповідь — одне джерело, а не виняток
//! у `.jscpd.json`.
//!
//! Модуль компілюється лише під `cfg(test)` — у звичайній збірці його немає.

use std::fs;

use tempfile::TempDir;

/// Пише `content` у `tmp/rel`, створюючи проміжні каталоги. Panic-on-error —
/// це тест-хелпер: збій підготовки fixture має валити тест голосно.
pub(crate) fn write(tmp: &TempDir, rel: &str, content: &str) {
    let path = tmp.path().join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}
