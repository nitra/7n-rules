# Порт перевірки `.github/workflows/lint-js.yml` з `npm/scripts/check-js-lint.mjs`
# (js-lint.mdc) — структурні очікування `verifyLintJsWorkflowStructure`.
#
# Запуск (локально):
#   conftest test .github/workflows/lint-js.yml -p npm/policy/js_lint \
#     --namespace js_lint.lint_js_yml
#
# Перевіряє: є крок `actions/checkout@v6` з `with.persist-credentials: false`,
# є крок `./.github/actions/setup-bun-deps`, у `run` є `bunx oxlint`, `bunx eslint .`,
# `bunx jscpd .`, у `run` НЕМАЄ `oxlint --fix` чи `eslint --fix` (CI не повинен
# редагувати код).
#
# Універсальні workflow-перевірки (concurrency, заборонені setup-bun/cache, shell
# line-continuation) — у `ga.workflow_common`. Дубль JS-перевірок у `lint.yml` —
# у JS-частині `check-js-lint.mjs` (потребує другого workflow-файлу).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package js_lint.lint_js_yml

import rego.v1

# Усі кроки з усіх jobs — для substring-перевірок.
all_steps contains step if {
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
}

all_uses_blob := concat("\n", [u |
	some step in all_steps
	u := object.get(step, "uses", "")
])

all_run_blob := concat("\n", [r |
	some step in all_steps
	r := step_run_text(step)
])

# ── deny: required uses ────────────────────────────────────────────────────

deny contains msg if {
	not contains(all_uses_blob, "actions/checkout@v6")
	msg := "lint-js.yml: відсутній крок uses: actions/checkout@v6 (js-lint.mdc)"
}

deny contains msg if {
	not contains(all_uses_blob, "./.github/actions/setup-bun-deps")
	msg := "lint-js.yml: відсутній крок uses: ./.github/actions/setup-bun-deps (js-lint.mdc)"
}

deny contains msg if {
	not has_checkout_persist_credentials_false
	msg := "lint-js.yml: actions/checkout@v6 має бути з with.persist-credentials: false (js-lint.mdc)"
}

# ── deny: required run substrings ─────────────────────────────────────────

deny contains msg if {
	not contains(all_run_blob, "bunx oxlint")
	msg := "lint-js.yml: у run немає `bunx oxlint` (js-lint.mdc)"
}

deny contains msg if {
	not contains(all_run_blob, "bunx eslint .")
	msg := "lint-js.yml: у run немає `bunx eslint .` (js-lint.mdc)"
}

deny contains msg if {
	not contains(all_run_blob, "bunx jscpd .")
	msg := "lint-js.yml: у run немає `bunx jscpd .` (js-lint.mdc)"
}

# ── deny: --fix у CI заборонено ───────────────────────────────────────────

deny contains msg if {
	regex.match(`bunx\s+oxlint[^\n]*--fix`, all_run_blob)
	msg := "lint-js.yml: у run є oxlint з `--fix` (у CI заборонено) (js-lint.mdc)"
}

deny contains msg if {
	contains(all_run_blob, "eslint --fix")
	msg := "lint-js.yml: у run є `eslint --fix` (у CI заборонено) (js-lint.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

has_checkout_persist_credentials_false if {
	some step in all_steps
	contains(object.get(step, "uses", ""), "actions/checkout@v6")
	step.with["persist-credentials"] == false
}

step_run_text(step) := step.run if is_string(step.run)

else := concat("\n", [s | some s in step.run]) if is_array(step.run)

else := ""
