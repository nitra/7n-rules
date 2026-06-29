# Перевірка `.vscode/extensions.json` для tauri (tauri.mdc).
#
# Викликається з `rules/tauri/js/tooling.mjs` через `runConftestBatch` лише
# ПІСЛЯ того, як JS виявив маркер Tauri-проєкту (`src-tauri/` каталог,
# `tauri.conf.json` у будь-якому пакеті, або залежність `@tauri-apps/*`).
# Без `target.json` поруч (не auto-discoverable через `n-cursor fix`) — це
# conditional правило.
#
# Canonical (tauri.mdc): `recommendations` має містити `tauri-apps.tauri-vscode`.
# `rust-lang.rust-analyzer` і `tamasfe.even-better-toml` — вимагаються правилом
# `rust` (rust.mdc), бо Tauri-проєкт завжди має `src-tauri/Cargo.toml`.
package tauri.vscode_extensions

import rego.v1

required_extensions := {"tauri-apps.tauri-vscode"}

missing_extension_template := ".vscode/extensions.json: recommendations має містити %q (tauri.mdc)"

recommendations_set := {r | some r in object.get(input, "recommendations", [])}

deny contains msg if {
	some required in required_extensions
	not required in recommendations_set
	msg := sprintf(missing_extension_template, [required])
}
