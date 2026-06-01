# Перевірка `pyproject.toml` (python.mdc).
#
# Канон надходить через --data: { "template": { "deny": ... } }
# Структура --data сформована з template/pyproject.toml.deny.toml.
# FS-перевірки (`poetry.lock`, `poetry.toml`, `uv.lock`, `package.json`) — у JS.
#
# Дві групи правил:
#   1. Заборона Poetry — `[tool.poetry]` (та інші заборонені під-таблиці `tool`)
#      керується deny-template, drift-safe.
#   2. PEP 621 — `[project].name` і `[project].version` обовʼязкові (структурна
#      вимога без канонічного літералу, тому inline).
package python.pyproject_toml

import rego.v1

# ── Заборона Poetry (deny-template керує переліком) ──────────────────────────

deny contains msg if {
	some key, reason in object.get(data.template.deny, "tool", {})
	key in object.keys(object.get(input, "tool", {}))
	msg := sprintf("pyproject.toml: [tool.%s] — %s", [key, reason])
}

# ── PEP 621: обовʼязкові [project].name / [project].version ──────────────────

deny contains msg if {
	not project_field_set("name")
	msg := "pyproject.toml: відсутній [project].name (PEP 621 — мігруй з [tool.poetry], python.mdc)"
}

deny contains msg if {
	not project_field_set("version")
	msg := "pyproject.toml: відсутній статичний [project].version (PEP 621, python.mdc)"
}

project_field_set(key) if {
	value := object.get(object.get(input, "project", {}), key, "")
	value != ""
}
