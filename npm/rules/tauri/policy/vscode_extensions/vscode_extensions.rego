# Перевірка `.vscode/extensions.json` для tauri (tauri.mdc).
#
# Викликається з `check-tauri.mjs` через `runConftestBatch` лише ПІСЛЯ того,
# як JS виявив маркер Tauri-проєкту (`src-tauri/` каталог, `tauri.conf.json`
# у будь-якому пакеті, або залежність `@tauri-apps/*`). Без `target.json` поруч
# (не auto-discoverable через `n-cursor check`) — інакше false-positive порушення на не-Tauri проєктах.
#
# Canonical (tauri.mdc): `recommendations` має містити обидва записи —
#   - tauri-apps.tauri-vscode
#   - rust-lang.rust-analyzer
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
package tauri.vscode_extensions

import rego.v1

required_extensions := {"tauri-apps.tauri-vscode", "rust-lang.rust-analyzer"}

missing_extension_template := ".vscode/extensions.json: recommendations має містити %q (tauri.mdc)"

# Множина усіх записів `recommendations` (поза deny — performance/non-loop-expression).
recommendations_set := {r | some r in object.get(input, "recommendations", [])}

deny contains msg if {
	some required in required_extensions
	not required in recommendations_set
	msg := sprintf(missing_extension_template, [required])
}
