# Порт структурних перевірок `package.json` з `npm/scripts/check-bun.mjs` (bun.mdc).
#
# Запуск (локально, КОРЕНЕВИЙ package.json):
#   conftest test package.json -p npm/policy/bun --namespace bun.package_json
#
# Перевіряє: відсутність `packageManager`, відсутність кореневих `dependencies`,
# у `devDependencies` лише `@nitra/*`, агрегований `lint`-скрипт (якщо є `lint-*`
# скрипти): покриває всі lint-* через `bun run`, закінчується на `&& oxfmt .`.
#
# Перевірки, які ЗАЛИШИЛИСЬ у JS (потребують FS / cross-file):
#  - `lint-docker` / `lint-k8s` коли `.n-cursor.json:rules` містить відповідне
#    правило (потрібен другий файл-вхід — у Rego без `--combine` не зробити).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package bun.package_json

import rego.v1

# ── Шаблони повідомлень ────────────────────────────────────────────────────

# Через `concat` — дотримуємося regal style/line-length.
lint_aggregate_missing_template := concat(" ", [
	"У package.json є скрипти %v, але немає агрегованого `lint`.",
	"Додай скрипт, який запускає їх через `bun run` (bun.mdc)",
])

# ── deny: заборонені поля ──────────────────────────────────────────────────

deny contains msg if {
	pm := object.get(input, "packageManager", "")
	pm != ""
	msg := sprintf("package.json містить поле packageManager: %q — видали його (bun.mdc)", [pm])
}

# `dependencies` не повинно бути взагалі — навіть пусте `{}`. Сентинельний рядок
# дозволяє відрізнити «поле відсутнє» від «поле є з будь-яким значенням».
deny contains msg if {
	object.get(input, "dependencies", "__bun_missing__") != "__bun_missing__"
	msg := "Кореневий package.json не повинен містити поле dependencies — додай залежності в workspace-пакети (bun.mdc)"
}

# ── deny: devDependencies — лише `@nitra/*` ───────────────────────────────

deny contains msg if {
	is_object(input.devDependencies)
	some name, _ in input.devDependencies
	not startswith(name, "@nitra/")
	msg := sprintf("Кореневі devDependencies: дозволені лише @nitra/* — прибери або перенеси: %s (bun.mdc)", [name])
}

# ── deny: агрегований lint-скрипт ─────────────────────────────────────────
#
# Якщо в `scripts` є хоч один `lint-*`, має бути скрипт `lint`, у якому
# через `bun run <ім'я>` викликається кожен такий скрипт; рядок завершується
# на `&& oxfmt .`.

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

	# Перевіряємо, що рядок завершується `&& oxfmt .` (з можливими пробілами/табами).
	# Trim не потрібен — пробіли/таби в кінці допускаємо в самому regex (`[ \t]*$`).
	not regex.match(`&&[ \t]+oxfmt[ \t]+\.[ \t]*$`, lint_script)
	msg := "Скрипт `lint` має закінчуватися на `&& oxfmt .` (bun.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

# Ключі скриптів, що починаються з `lint-` (наприклад `lint-js`, `lint-ga`).
lint_prefixed_scripts := [name |
	some name, _ in object.get(input, "scripts", {})
	startswith(name, "lint-")
]

# Значення `scripts.lint` як рядок (порожній, якщо поля немає або тип не string).
default lint_script := ""

lint_script := input.scripts.lint if is_string(input.scripts.lint)
