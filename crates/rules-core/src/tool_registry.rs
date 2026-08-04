//! Реєстр зовнішніх CLI-тулів — **спільне джерело правди** з JS-боком.
//!
//! Дані читаються з `npm/scripts/lib/tools.json` (описи install-стратегій) і
//! `npm/scripts/lib/tool-pins.json` (закріплені версії). Той самий
//! `tools.json` читає `npm/scripts/lib/ensure-tool.mjs`, будуючи з нього свій
//! `TOOLS` — тобто таблиці не дві, а одна (мінідизайн
//! `docs/specs/2026-08-04-tools-ensure-design.md`, розділ 3).
//!
//! # Чому `include_str!`, а не читання з диска
//!
//! Версії крейтів і `@7n/rules` випускаються lockstep (Р7 спеки міграції),
//! тож вбудована на збірці копія не може розійтися з опублікованим пакетом у
//! межах релізу. Натомість рантайм-читання вимагало б резолву кореня пакета
//! (і власної fail-closed гілки, коли його немає) заради нульового виграшу:
//! команда `tools ensure` має працювати й тоді, коли `@7n/rules` поруч не
//! резолвиться.
//!
//! # Шаблони замість замикань
//!
//! У JS-канону `asset`/`binFinder` були функціями `(ver) => string`. Щоб
//! реєстр став даними, вони стали рядковими шаблонами з `{ver}` і `{arch}`;
//! стиль назви архітектури оголошує сам запис (`archStyle`), а розгортання —
//! [`ToolEntry::asset`]/[`ToolEntry::bin_path`]. Збіг розгортання обох мов
//! гейтиться крос-мовним parity-тестом (`tools-registry-parity.test.mjs`).

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Deserialize;

/// Декларативний реєстр install-стратегій (спільний із JS).
const TOOLS_JSON: &str = include_str!("../../../npm/scripts/lib/tools.json");

/// Закріплені версії GitHub-Release тулів (спільні з JS).
const TOOL_PINS_JSON: &str = include_str!("../../../npm/scripts/lib/tool-pins.json");

/// Один запис реєстру — порт `ToolEntry` (`ensure-tool.mjs`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolEntry {
    /// Формула brew (macOS).
    pub brew: String,
    /// Пакет scoop (Windows); `None` = manifest-у немає, іде GitHub-fallback.
    pub scoop: Option<String>,
    /// Репозиторій релізів у форматі `owner/repo`.
    pub github: String,
    /// Стиль назви архітектури в asset-і: `hk` | `conftest` | `actionlint`.
    pub arch_style: String,
    /// Чи release-ресурс є tar-архівом (`false` = сирий бінарник).
    pub archive: bool,
    /// Шаблон назви release-ресурсу (`{ver}`, `{arch}`).
    pub asset: String,
    /// Шаблон шляху бінарника всередині архіву; `None` = корінь архіву.
    pub bin_path: Option<String>,
    /// Префікс git-тегу релізу перед версією (`v` або порожній).
    pub tag_prefix: String,
}

/// Кореневий обʼєкт `tools.json`.
#[derive(Debug, Deserialize)]
struct ToolsFile {
    tools: BTreeMap<String, ToolEntry>,
}

/// Кореневий обʼєкт `tool-pins.json`. `pinnedAt` (вік пінів) читає лише
/// JS-гейт свіжості (`checkToolPinsFreshness`) — тут поле не потрібне.
#[derive(Debug, Deserialize)]
struct PinsFile {
    versions: BTreeMap<String, String>,
}

/// Розібраний реєстр (одноразовий парсинг вбудованого JSON).
///
/// Некоректний JSON тут — не рантайм-збій, а зламані дані власного репо, які
/// ловить тест крейта ще до збірки бінаря, тому `expect` замість `Result`:
/// нести `Result` крізь усіх викликачів заради стану, недосяжного в
/// зібраному артефакті, — зайвий шум.
fn tools() -> &'static BTreeMap<String, ToolEntry> {
    static TOOLS: OnceLock<BTreeMap<String, ToolEntry>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        serde_json::from_str::<ToolsFile>(TOOLS_JSON)
            .expect("tools.json (вбудований) має бути валідним реєстром тулів")
            .tools
    })
}

/// Розібрані піни версій (одноразовий парсинг вбудованого JSON).
fn pins() -> &'static BTreeMap<String, String> {
    static PINS: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    PINS.get_or_init(|| {
        serde_json::from_str::<PinsFile>(TOOL_PINS_JSON)
            .expect("tool-pins.json (вбудований) має бути валідним")
            .versions
    })
}

/// Ідентифікатори всіх задекларованих тулів (детермінований порядок — ключі
/// `BTreeMap`, тобто лексикографічний).
pub fn tool_ids() -> Vec<&'static str> {
    tools().keys().map(String::as_str).collect()
}

/// Запис реєстру за ідентифікатором тула.
pub fn entry(tool_id: &str) -> Option<&'static ToolEntry> {
    tools().get(tool_id)
}

/// Закріплена версія тула (без префікса тегу) або `None`, якщо пін забули
/// додати — це конфігураційна помилка репо, як і в JS `resolvePinnedVersion`.
pub fn pinned_version(tool_id: &str) -> Option<&'static str> {
    pins().get(tool_id).map(String::as_str)
}

/// Назва архітектури поточного хоста в заданому стилі — порт `mapArch`
/// (`ensure-tool.mjs`). Не-x86_64 хости йдуть у «arm»-гілку так само, як у
/// JS будь-який `process.arch !== 'x64'`.
pub fn map_arch(arch_style: &str) -> &'static str {
    let is_x64 = std::env::consts::ARCH == "x86_64";
    match arch_style {
        "actionlint" => {
            if is_x64 {
                "amd64"
            } else {
                "arm64"
            }
        }
        "conftest" => {
            if is_x64 {
                "x86_64"
            } else {
                "arm64"
            }
        }
        // hk / shellcheck / dotenv-linter / mago
        _ => {
            if is_x64 {
                "x86_64"
            } else {
                "aarch64"
            }
        }
    }
}

impl ToolEntry {
    /// Розгортає шаблон запису: `{ver}` → версія, `{arch}` → архітектура у
    /// стилі запису.
    fn render(&self, template: &str, ver: &str) -> String {
        template
            .replace("{ver}", ver)
            .replace("{arch}", map_arch(&self.arch_style))
    }

    /// Назва release-ресурсу для заданої версії.
    pub fn asset(&self, ver: &str) -> String {
        self.render(&self.asset, ver)
    }

    /// Шлях бінарника всередині архіву (`None` = корінь архіву).
    pub fn bin_path(&self, ver: &str) -> Option<String> {
        self.bin_path.as_ref().map(|t| self.render(t, ver))
    }

    /// URL завантаження release-ресурсу — порт `buildGithubDownloadUrl`.
    pub fn download_url(&self, ver: &str) -> String {
        format!(
            "https://github.com/{}/releases/download/{}{ver}/{}",
            self.github,
            self.tag_prefix,
            self.asset(ver)
        )
    }
}

/// Per-OS install-підказка для тула з реєстру — обгортка
/// [`crate::tool_resolve::install_hint`], яка бере поля з єдиного джерела
/// правди замість локальних констант концерну.
pub fn install_hint_for(tool_id: &str) -> Option<String> {
    let entry = entry(tool_id)?;
    Some(crate::tool_resolve::install_hint(
        tool_id,
        &entry.brew,
        entry.scoop.as_deref(),
        &entry.github,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Реєстр вбудовується і розбирається; склад — рівно ті 11 тулів, що є в
    /// JS-канону. Тест — і перевірка валідності JSON (інакше `expect` вище
    /// впаде), і change-detector складу.
    #[test]
    fn registry_lists_all_declared_tools() {
        assert_eq!(
            tool_ids(),
            vec![
                "actionlint",
                "conftest",
                "dotenv-linter",
                "hadolint",
                "hk",
                "kubeconform",
                "kubescape",
                "mago",
                "opa",
                "regal",
                "shellcheck",
            ]
        );
    }

    /// Кожен тул реєстру має закріплену версію — той самий інваріант, що
    /// гейтить JS-тест «кожен тул з TOOLS має пін у tool-pins.json».
    #[test]
    fn every_tool_has_a_pinned_version() {
        for tool_id in tool_ids() {
            assert!(
                pinned_version(tool_id).is_some(),
                "немає піна версії для {tool_id}"
            );
        }
    }

    /// Розгортання шаблонів: обидва плейсхолдери, включно з тими записами, де
    /// бінарник лежить у підкаталозі архіву.
    #[test]
    fn templates_render_version_and_arch() {
        let shellcheck = entry("shellcheck").unwrap();
        let arch = map_arch("hk");
        assert_eq!(
            shellcheck.asset("0.11.0"),
            format!("shellcheck-v0.11.0.linux.{arch}.tar.xz")
        );
        assert_eq!(
            shellcheck.bin_path("0.11.0"),
            Some("shellcheck-v0.11.0/shellcheck".to_string())
        );
        assert_eq!(entry("opa").unwrap().bin_path("1.18.2"), None);
    }

    /// `tagPrefix` — не косметика: mago тегує реліз без `v`, і URL мусить це
    /// відображати (інакше 404 на завантаженні).
    #[test]
    fn download_url_honours_tag_prefix() {
        assert!(entry("conftest")
            .unwrap()
            .download_url("0.68.2")
            .contains("/releases/download/v0.68.2/"));
        assert!(entry("mago")
            .unwrap()
            .download_url("1.45.0")
            .contains("/releases/download/1.45.0/"));
    }

    /// Стилі архітектури розрізняються (інакше `archStyle` був би мертвим
    /// полем). Порівнюються саме `hk` і `actionlint`: вони різні на ОБОХ
    /// підтримуваних хостах (`x86_64`/`amd64` та `aarch64`/`arm64`), тоді як
    /// `conftest` збігається то з одним, то з іншим залежно від архітектури.
    #[test]
    fn arch_styles_differ() {
        assert_ne!(map_arch("actionlint"), map_arch("hk"));
        assert!(["amd64", "arm64"].contains(&map_arch("actionlint")));
        assert!(["x86_64", "aarch64"].contains(&map_arch("hk")));
    }

    /// Підказка будується з полів реєстру, а не з констант концерну.
    #[test]
    fn install_hint_comes_from_registry() {
        let hint = install_hint_for("kubeconform").unwrap();
        assert!(hint.contains("kubeconform"), "{hint}");
        assert!(install_hint_for("no-such-tool").is_none());
    }
}
