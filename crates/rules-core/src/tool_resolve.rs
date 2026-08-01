// cspell:ignore USERPROFILE
//! Native-резолв зовнішніх CLI-тулів — дзеркало **перших двох** кроків
//! `ensureTool` (`npm/scripts/lib/ensure-tool.mjs:519-539`): PATH → керований
//! кеш бінарників. Потрібен кожному native-концерну, що спавнить зовнішній
//! тул (`k8s/kubeconform` — перший; далі `kubescape`, `conftest`, `opa`,
//! `regal`, …).
//!
//! # Чому тільки два кроки з чотирьох
//!
//! `ensureTool` має чотири кроки: PATH → кеш → **авто-install** → hard-fail.
//! Крок 3 (авто-install) — це brew/scoop-спавн на macOS/Windows і
//! HTTP-завантаження GitHub-release-архіву з розпакуванням на Linux, плюс
//! міжпроцесний `withLock` і GitHub-API з токеном. У `rules-core` немає (і
//! свідомо не заводиться) HTTP-клієнта: крейт лишається офлайновим
//! детермінованим ядром лінту, а не встановлювачем тулів. Тому native-шар резолвить
//! **уже встановлений** тул, а встановлення лишається за JS-каноном.
//!
//! Наслідок для маршрутизації: концерн, чий тул не резолвиться нативно, НЕ
//! пропускає перевірку (це був би fail-open — на ефемерному CI-раннері з
//! порожнім кешем тул майже завжди відсутній, і native мовчки не перевіряв би
//! нічого). Замість цього він повертає [`crate::RulesError::NativeDelegate`],
//! і JS-диспетчер (`detect.mjs`) падає назад на `main.mjs`, де `ensureTool`
//! доводить встановлення до кінця. Деталі контракту — доккомент
//! [`crate::concerns::NATIVE_DELEGATING_CONCERNS`].
//!
//! # Паритет із `resolve-cmd.mjs`
//!
//! [`resolve_cmd`] — точний порт `resolveCmd`
//! (`npm/scripts/utils/resolve-cmd.mjs:50-60`): чистий скан каталогів `PATH`
//! без субпроцесу `which`/`where`, `PATH` читається на кожен виклик (щоб
//! runtime-підміна в тестах була видима), на Windows додаються суфікси з
//! `PATHEXT`. «Виконуваний» = існує, є звичайним файлом і має x-біт (POSIX);
//! на Windows x-біта нема — достатньо того, що це файл із відомим суфіксом,
//! як і в JS (`accessSync(X_OK)` на Windows завжди проходить для наявного
//! файлу).

use std::path::{Path, PathBuf};

/// Дефолтний `PATHEXT` Windows, якщо змінна не виставлена — той самий
/// список, що `WINDOWS_DEFAULT_PATHEXT` (`resolve-cmd.mjs:18`).
const WINDOWS_DEFAULT_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD";

/// Чи є шлях виконуваним звичайним файлом — порт `isExecutableFile`
/// (`resolve-cmd.mjs:25-33`). Тека з іменем команди не вважається збігом.
fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // `accessSync(path, X_OK)` перевіряє ефективний доступ поточного
        // процесу; тут — наявність будь-якого x-біта. Для реальних
        // PATH-каталогів (0755-бінарники) це той самий вислід, а різниця
        // проявилась би лише на екзотичних ACL, яких у lint-контурі немає.
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Суфікси-кандидати імені команди — порт `candidateSuffixes`
/// (`resolve-cmd.mjs:40-43`): POSIX — лише саме ім'я; Windows — саме ім'я
/// плюс розширення з `PATHEXT`.
fn candidate_suffixes() -> Vec<String> {
    if !cfg!(windows) {
        return vec![String::new()];
    }
    let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| WINDOWS_DEFAULT_PATHEXT.to_string());
    let mut out = vec![String::new()];
    out.extend(
        pathext
            .split(';')
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    );
    out
}

/// Скан явного списку каталогів — «чисте» ядро [`resolve_cmd`] без читання
/// оточення. Винесене окремо саме заради тестів: підміна процес-глобального
/// `PATH` ламала б будь-який паралельний тест крейта, що спавнить `git`
/// (`worktree`/`changed_files`).
fn resolve_cmd_in(cmd: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let suffixes = candidate_suffixes();
    for dir in dirs {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for suffix in &suffixes {
            let candidate = dir.join(format!("{cmd}{suffix}"));
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

/// Абсолютний шлях до команди в `PATH` або `None` — точний порт `resolveCmd`
/// (`resolve-cmd.mjs:50-60`). `PATH` читається на кожен виклик (як і в JS).
pub fn resolve_cmd(cmd: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let dirs: Vec<PathBuf> = std::env::split_paths(&path_var).collect();
    resolve_cmd_in(cmd, &dirs)
}

/// Каталог керованого кешу бінарників — порт `getCacheDir`
/// (`ensure-tool.mjs:120-128`), включно з test-only override
/// `N_CURSOR_TOOL_CACHE_DIR` (він читається ПЕРШИМ, як і в JS).
pub fn tool_cache_dir() -> Option<PathBuf> {
    if let Ok(override_dir) = std::env::var("N_CURSOR_TOOL_CACHE_DIR") {
        if !override_dir.is_empty() {
            return Some(PathBuf::from(override_dir));
        }
    }
    if cfg!(windows) {
        let local_app_data = std::env::var("LOCALAPPDATA")
            .ok()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .or_else(|| home_dir().map(|h| h.join("AppData").join("Local")))?;
        return Some(local_app_data.join("@7n").join("rules").join("bin"));
    }
    Some(
        home_dir()?
            .join(".cache")
            .join("@7n")
            .join("rules")
            .join("bin"),
    )
}

/// Домашній каталог — еквівалент `os.homedir()`. Без зайвої залежності
/// (`dirs`/`home`): у lint-контурі достатньо `HOME`/`USERPROFILE`, які
/// виставлені в усіх підтримуваних оточеннях (macOS/Linux/Windows CI).
fn home_dir() -> Option<PathBuf> {
    let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var(key)
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// «Чисте» ядро [`resolve_provisioned_tool`] з явними джерелами: список
/// каталогів `PATH` і каталог кешу. Винесене з тих самих міркувань, що й
/// [`resolve_cmd_in`].
fn resolve_provisioned_tool_in(
    tool_id: &str,
    path_dirs: &[PathBuf],
    cache_dir: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(from_path) = resolve_cmd_in(tool_id, path_dirs) {
        return Some(from_path);
    }
    let cached = cache_dir?.join(tool_id);
    // JS-крок 2 перевіряє лише `existsSync` (без x-біта) — дзеркалимо буквально.
    if cached.exists() {
        return Some(cached);
    }
    None
}

/// Резолвить **уже встановлений** зовнішній тул: `PATH` → керований кеш.
/// `None` = тул відсутній і його встановлення лишається за JS-каноном
/// (доккомент модуля).
pub fn resolve_provisioned_tool(tool_id: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let dirs: Vec<PathBuf> = std::env::split_paths(&path_var).collect();
    resolve_provisioned_tool_in(tool_id, &dirs, tool_cache_dir().as_deref())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    /// Записує виконуваний shell-скрипт-заглушку.
    #[cfg(unix)]
    fn write_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// `resolveCmd` знаходить виконуваний файл у каталозі-кандидаті.
    ///
    /// Тести навмисно НЕ підміняють процес-глобальний `PATH`: у тому ж
    /// процесі паралельно біжать тести `worktree`/`changed_files`, які
    /// спавнять `git` — підміна `PATH` валила б їх випадковим чином.
    #[cfg(unix)]
    #[test]
    fn resolve_cmd_finds_executable_in_dir() {
        let tmp = TempDir::new().unwrap();
        let bin = tmp.path().join("fake-tool-resolve-ok");
        write_executable(&bin);
        assert_eq!(
            resolve_cmd_in("fake-tool-resolve-ok", &[tmp.path().to_path_buf()]),
            Some(bin)
        );
    }

    /// Тека з іменем команди — не збіг (`isExecutableFile` вимагає файл).
    #[cfg(unix)]
    #[test]
    fn resolve_cmd_ignores_directory_with_command_name() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir(tmp.path().join("fake-tool-dir")).unwrap();
        assert_eq!(
            resolve_cmd_in("fake-tool-dir", &[tmp.path().to_path_buf()]),
            None
        );
    }

    /// Файл без x-біта — не збіг (POSIX-гілка `accessSync(X_OK)`).
    #[cfg(unix)]
    #[test]
    fn resolve_cmd_ignores_non_executable_file() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("fake-tool-plain"), "x").unwrap();
        assert_eq!(
            resolve_cmd_in("fake-tool-plain", &[tmp.path().to_path_buf()]),
            None
        );
    }

    /// Порожній список каталогів і порожній елемент у ньому → `None`, без паніки
    /// (JS так само пропускає порожні сегменти `PATH`).
    #[test]
    fn resolve_cmd_empty_dirs_return_none() {
        assert_eq!(resolve_cmd_in("definitely-not-a-tool-xyz", &[]), None);
        assert_eq!(
            resolve_cmd_in("definitely-not-a-tool-xyz", &[PathBuf::new()]),
            None
        );
    }

    /// Порядок кандидатів — перший каталог `PATH` виграє (як у JS-циклі).
    #[cfg(unix)]
    #[test]
    fn resolve_cmd_prefers_first_matching_dir() {
        let tmp = TempDir::new().unwrap();
        let first = tmp.path().join("first");
        let second = tmp.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        write_executable(&first.join("dup-tool"));
        write_executable(&second.join("dup-tool"));
        assert_eq!(
            resolve_cmd_in("dup-tool", &[first.clone(), second]),
            Some(first.join("dup-tool"))
        );
    }

    /// Крок 2 `ensureTool`: тула нема в PATH, але він лежить у кеші → шлях із кешу.
    #[test]
    fn resolve_provisioned_tool_falls_back_to_cache() {
        let tmp = TempDir::new().unwrap();
        let cache = tmp.path().join("cache");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("kubeconform"), "binary").unwrap();
        assert_eq!(
            resolve_provisioned_tool_in("kubeconform", &[], Some(&cache)),
            Some(cache.join("kubeconform"))
        );
    }

    /// PATH виграє над кешем — той самий порядок кроків, що в `ensureTool`.
    #[cfg(unix)]
    #[test]
    fn resolve_provisioned_tool_prefers_path_over_cache() {
        let tmp = TempDir::new().unwrap();
        let path_dir = tmp.path().join("bin");
        let cache = tmp.path().join("cache");
        fs::create_dir_all(&path_dir).unwrap();
        fs::create_dir_all(&cache).unwrap();
        write_executable(&path_dir.join("kubeconform"));
        fs::write(cache.join("kubeconform"), "binary").unwrap();
        assert_eq!(
            resolve_provisioned_tool_in(
                "kubeconform",
                std::slice::from_ref(&path_dir),
                Some(&cache)
            ),
            Some(path_dir.join("kubeconform"))
        );
    }

    /// Ні в PATH, ні в кеші → `None` (сигнал «делегуй JS-канону»).
    #[test]
    fn resolve_provisioned_tool_missing_everywhere_is_none() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(
            resolve_provisioned_tool_in("kubeconform", &[], Some(tmp.path())),
            None
        );
    }

    /// `N_CURSOR_TOOL_CACHE_DIR` перекриває дефолтний кеш — той самий
    /// test-only override, що в `getCacheDir` (`ensure-tool.mjs:121-122`).
    /// Єдиний тест модуля, що мутує оточення; змінна наша власна, її не читає
    /// жоден інший тест крейта, тож гонки з `git`-тестами тут немає.
    #[test]
    fn tool_cache_dir_honours_override() {
        let tmp = TempDir::new().unwrap();
        let saved = std::env::var("N_CURSOR_TOOL_CACHE_DIR").ok();
        std::env::set_var("N_CURSOR_TOOL_CACHE_DIR", tmp.path());
        let resolved = tool_cache_dir();
        match saved {
            Some(v) => std::env::set_var("N_CURSOR_TOOL_CACHE_DIR", v),
            None => std::env::remove_var("N_CURSOR_TOOL_CACHE_DIR"),
        }
        assert_eq!(resolved, Some(tmp.path().to_path_buf()));
    }
}
