//! Scratch-контур `exec-tool` (зріз 5 контракту v3.1, рішення А/Б спеки
//! `docs/specs/2026-08-01-plugin-contract-v31-surfaces.md`): тимчасовий
//! каталог обміну файлами між гостем і спавненим тулом.
//!
//! # Навіщо окремий канал, якщо є `stdin`/`stdout`
//!
//! Реальні обгортки зовнішніх процесів обмінюються не потоками, а ФАЙЛАМИ:
//! `js/jscpd_duplicates` читає `jscpd-report.json`, який тул написав на диск;
//! `js-run/runtime` кладе тулу rego-політики, вшиті в компонент. Ні `stdin`,
//! ні `stdout` цього не покривають, а давати гостю запис у репо — інверсія
//! моделі (усі мутації йдуть через `FixPlan`, який хост валідує). Scratch —
//! третій варіант: каталог поза репо, з якого хост забирає рівно те, що
//! гість назвав глобом.
//!
//! # Час життя і прибирання
//!
//! Каталог живе РІВНО один `detect`/`fix`-виклик: [`ScratchDir`] — обгортка
//! `tempfile::TempDir`, а `LoadedPlugin` скидає його і ПЕРЕД, і ПІСЛЯ
//! кожного виклику гостя (`Drop` `TempDir` рекурсивно видаляє каталог).
//! Скидання «перед» — не надмірність: якщо гість тріпнув (trap/panic),
//! виклик повернувся `Err`, і саме воно гарантує, що наступний виклик не
//! успадкує сміття попереднього.
//!
//! # Ліміти
//!
//! Вхід (`scratch-in`) обмежує валідатор контракту
//! (`rules_contract::validators::tool`) ДО матеріалізації. Вихід
//! (`scratch-out`) обмежує вже цей модуль ([`MAX_SCRATCH_OUT_FILES`],
//! [`MAX_SCRATCH_OUT_TOTAL_BYTES`]) — його розмір визначає не гість, а
//! спавнений тул, тобто наперед його не перевірити.

use std::io;
use std::path::{Path, PathBuf};

use rules_contract::tool::ScratchFile;

/// Максимальна кількість файлів, які хост збирає за `scratch-out`-глобами.
/// Реальні звіти — один-два файли; сотні означають, що глоб гостя
/// «зачерпнув» робочий каталог тула цілком.
pub(crate) const MAX_SCRATCH_OUT_FILES: usize = 256;

/// Максимальний сумарний розмір зібраних `scratch-out`-файлів (байти) —
/// вони їдуть через Component Model у пам'ять гостя, тож ліміт тут же й
/// охороняє гостя від власного занадто широкого глоба.
pub(crate) const MAX_SCRATCH_OUT_TOTAL_BYTES: usize = 16 * 1024 * 1024;

/// Максимальна глибина рекурсії обходу scratch-каталогу при зборі
/// `scratch-out` — тул може створити довільно глибоке дерево (чи симлінк-цикл
/// у ньому); обхід має завершитись у будь-якому разі.
const MAX_SCRATCH_WALK_DEPTH: usize = 16;

/// Тимчасовий каталог обміну одного `detect`/`fix`-виклику. Дроп типу
/// видаляє каталог рекурсивно (`tempfile::TempDir`).
pub(crate) struct ScratchDir {
    dir: tempfile::TempDir,
}

impl ScratchDir {
    /// Створює новий тимчасовий каталог. Помилка (read-only ФС, вичерпано
    /// місце) віддається наверх — хост перетворює її на `none` слоту
    /// `scratch-dir@1` / типізовану помилку в `tool-result`, не панікує.
    pub(crate) fn new() -> io::Result<Self> {
        Ok(Self {
            dir: tempfile::Builder::new()
                .prefix("n-rules-scratch-")
                .tempdir()?,
        })
    }

    /// Абсолютний шлях каталогу — payload слоту `scratch-dir@1`.
    pub(crate) fn path(&self) -> &Path {
        self.dir.path()
    }

    /// Матеріалізує `scratch-in` ПЕРЕД спавном тула. Шляхи вже перевірені
    /// валідатором контракту (без `..`/абсолютів) — тут лишається створити
    /// проміжні каталоги й записати вміст.
    ///
    /// `Err` — людиночитний текст для `tool-result.stderr`: хост НЕ спавнить
    /// тул, якщо вхід не вдалось підготувати (тул побачив би неповний набір
    /// файлів і збрехав би результатом).
    pub(crate) fn materialize(&self, files: &[ScratchFile]) -> Result<(), String> {
        for file in files {
            let target = self.dir.path().join(&file.path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|err| {
                    format!(
                        "exec-tool: не вдалось створити каталог scratch-in `{}`: {err}",
                        file.path
                    )
                })?;
            }
            std::fs::write(&target, file.content.as_bytes()).map_err(|err| {
                format!(
                    "exec-tool: не вдалось записати scratch-in `{}`: {err}",
                    file.path
                )
            })?;
        }
        Ok(())
    }

    /// Збирає файли scratch-каталогу, що збігаються з `globs`, ПІСЛЯ виходу
    /// процесу. Порожній `globs` — порожній результат без обходу диска.
    ///
    /// Що НЕ є помилкою (гість отримує просто менший список — доккомент WIT
    /// `tool-result.scratch-out`: «звіту немає» ≠ помилка):
    /// - файл, якого тул не створив (глоб ні з чим не збігся);
    /// - файл, який не читається чи не є валідним UTF-8 (контракт v3 несе
    ///   `string`, не `list<u8>` — байтовий обмін поза цим мінором);
    /// - перевищення лімітів — збір зупиняється, зібране повертається.
    ///
    /// Порядок результату — лексикографічний за відносним шляхом
    /// (`read_dir` не гарантує стабільного порядку між ФС), щоб діагностики
    /// гостя були детермінованими.
    pub(crate) fn collect(&self, globs: &[String]) -> Vec<ScratchFile> {
        if globs.is_empty() {
            return Vec::new();
        }
        let mut builder = globset::GlobSetBuilder::new();
        for pattern in globs {
            // Невалідний глоб-патерн тихо пропускається — та сама
            // skip-not-crash семантика, що `build_full_scope_files`
            // (`crates/rules-napi/src/lib.rs`) для глобів контрибуцій.
            if let Ok(glob) = globset::Glob::new(pattern) {
                builder.add(glob);
            }
        }
        let Ok(set) = builder.build() else {
            return Vec::new();
        };

        let mut collected: Vec<ScratchFile> = Vec::new();
        let mut total_bytes: usize = 0;
        let mut stack: Vec<(PathBuf, usize)> = vec![(self.dir.path().to_path_buf(), 0)];
        while let Some((dir, depth)) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_dir() {
                    if depth < MAX_SCRATCH_WALK_DEPTH {
                        stack.push((path, depth + 1));
                    }
                    continue;
                }
                // Симлінки не розіменовуються: тул, який лишив у scratch
                // симлінк на `/etc/passwd`, не має перетворити збір звіту на
                // читання довільного файлу хоста.
                if !file_type.is_file() {
                    continue;
                }
                let Ok(relative) = path.strip_prefix(self.dir.path()) else {
                    continue;
                };
                let relative = relative.to_string_lossy().replace('\\', "/");
                if !set.is_match(&relative) {
                    continue;
                }
                let Ok(content) = std::fs::read_to_string(&path) else {
                    continue;
                };
                if collected.len() >= MAX_SCRATCH_OUT_FILES
                    || total_bytes.saturating_add(content.len()) > MAX_SCRATCH_OUT_TOTAL_BYTES
                {
                    collected.sort_by(|a, b| a.path.cmp(&b.path));
                    return collected;
                }
                total_bytes += content.len();
                collected.push(ScratchFile {
                    path: relative,
                    content,
                });
            }
        }
        collected.sort_by(|a, b| a.path.cmp(&b.path));
        collected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_file(path: &str, content: &str) -> ScratchFile {
        ScratchFile {
            path: path.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn materialize_creates_nested_files() {
        let scratch = ScratchDir::new().unwrap();
        scratch
            .materialize(&[scratch_file("policies/deny.rego", "package p\n")])
            .unwrap();
        let written = std::fs::read_to_string(scratch.path().join("policies/deny.rego")).unwrap();
        assert_eq!(written, "package p\n");
    }

    #[test]
    fn collect_returns_only_glob_matches_sorted() {
        let scratch = ScratchDir::new().unwrap();
        scratch
            .materialize(&[
                scratch_file("report.json", "{}"),
                scratch_file("nested/b.json", "[]"),
                scratch_file("nested/a.json", "[1]"),
                scratch_file("noise.txt", "ignore me"),
            ])
            .unwrap();

        let collected = scratch.collect(&["**/*.json".to_string()]);
        let paths: Vec<&str> = collected.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["nested/a.json", "nested/b.json", "report.json"]);
    }

    /// Фіксує РЕАЛЬНУ семантику `globset` за дефолтних опцій: `*` матчить і
    /// `/`, тож `*.json` бере й вкладені файли. Це не недогляд — це рівно та
    /// сама конфігурація, з якою `crates/rules-napi::build_full_scope_files`
    /// фільтрує `concern-contribution.glob`, а WIT обіцяє гостю «той самий
    /// синтаксис». Тест стоїть тут саме тому, що інтуїція підказує
    /// протилежне (у picomatch/globstar-світі `*` не переходить `/`): якщо
    /// колись знадобиться `literal_separator`, вмикати його треба ОДНОЧАСНО
    /// в обох місцях, і цей тест впаде першим.
    #[test]
    fn star_glob_crosses_directory_separator_like_concern_globs() {
        let scratch = ScratchDir::new().unwrap();
        scratch
            .materialize(&[
                scratch_file("report.json", "{}"),
                scratch_file("nested/deep.json", "{}"),
            ])
            .unwrap();
        let collected = scratch.collect(&["*.json".to_string()]);
        let paths: Vec<&str> = collected.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["nested/deep.json", "report.json"]);
    }

    #[test]
    fn collect_without_globs_touches_nothing() {
        let scratch = ScratchDir::new().unwrap();
        scratch
            .materialize(&[scratch_file("a.json", "{}")])
            .unwrap();
        assert!(scratch.collect(&[]).is_empty());
    }

    /// Відсутній файл — не помилка (доккомент [`ScratchDir::collect`]):
    /// «звіту немає» гість трактує сам.
    #[test]
    fn missing_output_yields_empty_list_not_error() {
        let scratch = ScratchDir::new().unwrap();
        assert!(scratch
            .collect(&["jscpd-report.json".to_string()])
            .is_empty());
    }

    #[test]
    fn collect_stops_at_total_size_limit() {
        let scratch = ScratchDir::new().unwrap();
        let chunk = "x".repeat(MAX_SCRATCH_OUT_TOTAL_BYTES / 4 + 1);
        let files: Vec<ScratchFile> = (0..5)
            .map(|i| scratch_file(&format!("chunk-{i}.txt"), &chunk))
            .collect();
        scratch.materialize(&files).unwrap();
        let collected = scratch.collect(&["*.txt".to_string()]);
        assert!(
            collected.len() < 5,
            "ліміт сумарного розміру мав обірвати збір, зібрано {}",
            collected.len()
        );
    }

    #[test]
    fn dropping_scratch_dir_removes_it_from_disk() {
        let path = {
            let scratch = ScratchDir::new().unwrap();
            scratch.materialize(&[scratch_file("a.txt", "x")]).unwrap();
            scratch.path().to_path_buf()
        };
        assert!(!path.exists(), "TempDir мав видалити каталог при дропі");
    }
}
