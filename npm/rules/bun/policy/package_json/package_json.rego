# Перевірка кореневого `package.json` для bun (bun.mdc).
#
# Канон надходить через --data: { "template": { "deny": ... } }
# Структура --data сформована з template/package.json.deny.json
# (top-level fields заборонені у root).
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse-patterns, не виносяться у template):
#  - `devDependencies` лише `@nitra/*` + root-only тестові peer/tools для `n-cursor coverage`
#    (правило `test` enabled завжди — див. `test/auto.md`; published workspace-и не мають
#     `devDependencies` за `npm-module.mdc`)
#  - Агрегований `lint` скрипт (cross-script aggregation logic)
#
# Перевірки, які ЗАЛИШИЛИСЬ у JS (потребують FS / cross-file):
#  - `lint-docker` / `lint-k8s` коли `.n-cursor.json:rules` містить відповідне
#    правило (потрібен другий файл-вхід — у Rego без `--combine` не зробити).
package bun.package_json

import rego.v1

# ── Шаблони повідомлень ────────────────────────────────────────────────────

lint_aggregate_missing_template := concat(" ", [
	"У package.json є скрипти %v, але немає агрегованого `lint`.",
	"Додай скрипт, який запускає їх через `bun run` (bun.mdc)",
])

# ── deny: заборонені top-level поля (template-driven) ─────────────────────

# Сентинельний value відрізняє «поле відсутнє» від «поле є з будь-яким значенням»
# (наприклад `dependencies: {}` — присутнє але порожнє → теж заборонено).
deny contains msg if {
	some field, reason in data.template.deny
	object.get(input, field, "__bun_missing__") != "__bun_missing__"
	msg := sprintf("package.json: поле %s — %s", [field, reason])
}

# ── deny: devDependencies — лише `@nitra/*` + root-only тестові peer/tools ─

deny contains msg if {
	is_object(input.devDependencies)
	some name, _ in input.devDependencies
	not allowed_root_dev_dependency(name)
	msg := sprintf("Кореневі devDependencies: дозволені лише @nitra/* або root-only test peers — прибери або перенеси: %s (bun.mdc)", [name])
}

# ── deny: агрегований lint-скрипт (cross-script aggregation logic) ───────

deny contains msg if {
	count(lint_prefixed_scripts) > 0
	lint_script == ""
	msg := sprintf(lint_aggregate_missing_template, [lint_prefixed_scripts])
}

deny contains msg if {
	count(lint_prefixed_scripts) > 0
	lint_script != ""
	some script in lint_prefixed_scripts
	not contains(lint_script, sprintf("bun run %s", [script]))
	msg := sprintf("Скрипт `lint` має викликати `%s` через `bun run` (bun.mdc)", [script])
}

deny contains msg if {
	count(lint_prefixed_scripts) > 0
	lint_script != ""
	not regex.match(`&&[ \t]+oxfmt[ \t]+\.[ \t]*$`, lint_script)
	msg := "Скрипт `lint` має закінчуватися на `&& oxfmt .` (bun.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

allowed_root_test_deps := {"vitest", "@vitest/coverage-v8", "@stryker-mutator/vitest-runner", "@playwright/test"}

allowed_root_dev_dependency(name) if {
	startswith(name, "@nitra/")
} else if {
	# Vitest/Stryker peer/tools для `n-cursor coverage` живуть у корені будь-якого
	# монорепо-споживача: правило `test` enabled завжди, а published workspace-и
	# не мають `devDependencies` (`npm-module.mdc`).
	name in allowed_root_test_deps
}

lint_prefixed_scripts := [name |
	some name, _ in object.get(input, "scripts", {})
	startswith(name, "lint-")
]

default lint_script := ""

lint_script := input.scripts.lint if is_string(input.scripts.lint)
