# Перевірка `.cspell.json` (text.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ..., "contains": ..., "deny": ... } }
# Структура --data сформована з template/.cspell.json.{snippet,contains,deny}.json.
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse — не виноситься у template):
#  - `language` має бути присутнє (presence-only).
package text.cspell

import rego.v1

# ── deny: top-level snippet leafs (version etc) ──────────────────────────

deny contains msg if {
	some key, expected_value in data.template.snippet
	not is_array(expected_value)
	not is_object(expected_value)
	actual := object.get(input, key, null)
	actual != expected_value
	msg := sprintf(".cspell.json: %s має бути %v (text.mdc)", [key, expected_value])
}

# ── deny: ignorePaths subset-of ──────────────────────────────────────────

deny contains msg if {
	some field, expected_values in data.template.snippet
	is_array(expected_values)
	is_array(object.get(input, field, null))
	actual_set := {v | some v in input[field]}
	some required in expected_values
	not required in actual_set
	msg := sprintf(".cspell.json %s: додай %q (text.mdc)", [field, required])
}

# ── deny: language presence (inverse, in rego) ───────────────────────────

deny contains msg if {
	not object.get(input, "language", false)
	msg := ".cspell.json: відсутнє поле language (text.mdc)"
}

# ── deny: import substrings required (contains) ─────────────────────────

deny contains msg if {
	some field, needles in data.template.contains
	imports := object.get(input, field, [])
	is_array(imports)
	some needle in needles
	not has_substring_in_array(imports, needle)
	msg := sprintf(".cspell.json: %s має містити %q (text.mdc)", [field, needle])
}

# ── deny: import substrings forbidden ────────────────────────────────────

deny contains msg if {
	some forbidden, reason in data.template.deny["import-substrings"]
	imports := object.get(input, "import", [])
	is_array(imports)
	some imp in imports
	is_string(imp)
	contains(imp, forbidden)
	msg := sprintf(".cspell.json import містить заборонений %q — %s", [imp, reason])
}

# ── helpers ──────────────────────────────────────────────────────────────

has_substring_in_array(arr, needle) if {
	some item in arr
	is_string(item)
	contains(item, needle)
}
