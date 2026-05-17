# Перевірка `package.json` для правила security (security.mdc).
#
# Запуск (локально):
#   conftest test package.json -p npm/policy/security \
#     --namespace security.package_json
#
# Перевіряє: наявність `scripts.lint-security`, виклик `gitleaks detect`,
# входження `bun run lint-security` у агрегований `scripts.lint` (якщо `lint` є),
# та заборону `gitleaks` у dependencies/devDependencies (інструмент глобальний).
#
# FS-перевірки (наявність `.gitleaks.toml`, `useDefault = true`) — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package security.package_json

import rego.v1

gitleaks_pkg := "gitleaks"

dep_template := concat(" ", [
	"package.json: %q не повинен бути в %s —",
	"gitleaks встановлюється глобально (security.mdc)",
])

# ── deny: scripts.lint-security ──────────────────────────────────────────

deny contains msg if {
	scripts := object.get(input, "scripts", {})
	not "lint-security" in object.keys(scripts)
	msg := "package.json: відсутній scripts.lint-security — додай `gitleaks detect --no-banner` (security.mdc)"
}

deny contains msg if {
	lint_security := object.get(object.get(input, "scripts", {}), "lint-security", "")
	lint_security != ""
	not contains(lint_security, "gitleaks")
	msg := "package.json: lint-security має викликати `gitleaks` (security.mdc)"
}

deny contains msg if {
	lint_security := object.get(object.get(input, "scripts", {}), "lint-security", "")
	contains(lint_security, "gitleaks")
	not has_detect_or_git_subcommand(lint_security)
	msg := "package.json: lint-security має містити `detect` або `git` як gitleaks-subcommand (security.mdc)"
}

# ── deny: агрегований `lint` має кликати `bun run lint-security` ─────────

deny contains msg if {
	"lint-security" in object.keys(object.get(input, "scripts", {}))
	lint := object.get(object.get(input, "scripts", {}), "lint", "")
	lint != ""
	not contains(lint, "bun run lint-security")
	msg := "package.json: агрегований `lint` має містити `bun run lint-security` (security.mdc)"
}

# ── deny: `gitleaks` НЕ в dependencies/devDependencies ───────────────────

deny contains msg if {
	gitleaks_pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf(dep_template, [gitleaks_pkg, "dependencies"])
}

deny contains msg if {
	gitleaks_pkg in object.keys(object.get(input, "devDependencies", {}))
	msg := sprintf(dep_template, [gitleaks_pkg, "devDependencies"])
}

# ── helpers ──────────────────────────────────────────────────────────────

# Чи містить рядок subcommand `detect` або `git` (як слово, не як підрядок випадкового шляху).
# `gitleaks detect ...`, `gitleaks git --no-banner`, `gitleaks detect --source=.` — усі OK.
has_detect_or_git_subcommand(s) if regex.match(`\bgitleaks\s+(detect|git)\b`, s)
