# Перевірка `.vscode/extensions.json` для Azure Pipelines (azure-pipelines.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/extensions.json.snippet.json.
# `recommendations` — subset-of: кожна рекомендація з template має бути у input.
# Додаткові рекомендації від інших правил дозволені.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
#
# `%q` → `\"%v\"` (parser-агностична правка, `crates/plugin-ci-azure/src/lib.rs`
# доккомент модуля, і `docs/plans/2026-08-05-open-questions-register.md` §2.66):
# `regorus` відхиляє Go-формат-верб `%q` як HARD RUNTIME ERROR (не тихий
# деградейшн). `\"%v\"` дає БІТ-У-БІТ той самий рядок під `conftest` (Go's
# `sprintf("%q", s)` для звичайного ASCII-рядка без спецсимволів — це
# рівно `"` + s + `"`), тож 55+ `conftest verify`-тестів цієї теки лишаються
# зеленими без жодної зміни видимого тексту.
package azure_pipelines.vscode_extensions

import rego.v1

deny contains msg if {
	some rec in data.template.snippet.recommendations
	not rec in {r | some r in object.get(input, "recommendations", [])}
	msg := sprintf(".vscode/extensions.json: recommendations має містити \"%v\" (azure-pipelines.mdc)", [rec])
}
