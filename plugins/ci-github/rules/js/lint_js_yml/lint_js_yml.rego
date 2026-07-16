# Перевірка `.github/workflows/lint-js.yml` (js.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/lint-js.yml.snippet.yml.
# Required uses + run substrings зчитуються з template's eslint-job steps.
# Універсальні workflow-перевірки — у `ga.workflow_common`.
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse anti-patterns):
#  - `oxlint --fix` / `eslint --fix` у CI заборонено;
#  - actions/checkout (будь-який ref) має мати `with.persist-credentials: false`.
#
# Pin-aware: SHA-пін `owner/action@<40-hex>` (zizmor ref-pin; тег-коментар після
# `#` YAML-парсер відкидає) ЗАДОВОЛЬНЯЄ канонічний `owner/action@vN` з template —
# не вимагаємо (і не даунгрейдимо) назад до тега.
package js.lint_js_yml

import rego.v1

# Required `uses:` зі template — фільтруємо тільки кроки з uses.
expected_uses_set contains u if {
	some step in data.template.snippet.jobs.eslint.steps
	u := object.get(step, "uses", "")
	u != ""
}

# Required `run:` substrings (per-line з template).
expected_run_substrings contains line if {
	some step in data.template.snippet.jobs.eslint.steps
	r := object.get(step, "run", "")
	r != ""
	some raw in split(r, "\n")
	line := trim_space(raw)
	line != ""
}

# Аліаси на input.
all_steps contains step if {
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
}

all_uses_set contains u if {
	some step in all_steps
	u := object.get(step, "uses", "")
	u != ""
}

all_run_blob := concat("\n", [r |
	some step in all_steps
	r := step_run_text(step)
])

# ── deny: required uses ─────────────────────────────────────────────────

deny contains msg if {
	some required_use in expected_uses_set
	not has_use_satisfying(required_use)
	msg := sprintf("lint-js.yml: відсутній крок uses: %s (js.mdc)", [required_use])
}

# ── deny: required run substrings ───────────────────────────────────────

deny contains msg if {
	some required_run in expected_run_substrings
	not contains(all_run_blob, required_run)
	msg := sprintf("lint-js.yml: у run немає %q (js.mdc)", [required_run])
}

# ── deny: actions/checkout has persist-credentials: false (inverse) ─────

deny contains msg if {
	not has_checkout_persist_credentials_false
	msg := "lint-js.yml: actions/checkout має бути з with.persist-credentials: false (js.mdc)"
}

# ── deny: --fix у CI заборонено (inverse) ───────────────────────────────

deny contains msg if {
	regex.match(`bunx\s+oxlint[^\n]*--fix`, all_run_blob)
	msg := "lint-js.yml: у run є oxlint з `--fix` (у CI заборонено) (js.mdc)"
}

deny contains msg if {
	contains(all_run_blob, "eslint --fix")
	msg := "lint-js.yml: у run є `eslint --fix` (у CI заборонено) (js.mdc)"
}

# ── helpers ─────────────────────────────────────────────────────────────

has_checkout_persist_credentials_false if {
	some step in all_steps
	startswith(object.get(step, "uses", ""), "actions/checkout@")
	step.with["persist-credentials"] == false
}

# `uses:` з input задовольняє канонічний `owner/action@tag`: точний збіг…
uses_satisfies(actual, expected) if actual == expected

# …або той самий action-slug і ref — повний 40-hex commit SHA (zizmor ref-pin).
# Відповідність версії гарантує сам пін (тег-коментар `# vX` парсер відкидає).
uses_satisfies(actual, expected) if {
	slug := split(expected, "@")[0]
	startswith(actual, concat("", [slug, "@"]))
	parts := split(actual, "@")
	regex.match(`^[0-9a-fA-F]{40}$`, parts[count(parts) - 1])
}

has_use_satisfying(required) if {
	some u in all_uses_set
	uses_satisfies(u, required)
}

step_run_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
