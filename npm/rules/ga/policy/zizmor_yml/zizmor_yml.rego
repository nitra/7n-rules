# Перевірка `.github/zizmor.yml` для GitHub Actions (ga.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/zizmor.yml.snippet.yml.
# Канонічний шлях — `rules.unpinned-uses.config.policies."*"`; expected value
# (наприклад `"ref-pin"`) приходить із template, path лишається тут.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.zizmor_yml

import rego.v1

deny contains msg if {
	expected := data.template.snippet.rules["unpinned-uses"].config.policies["*"]
	policies := object.get(
		object.get(
			object.get(object.get(input, "rules", {}), "unpinned-uses", {}),
			"config",
			{},
		),
		"policies",
		{},
	)
	object.get(policies, "*", null) != expected
	msg := sprintf(".github/zizmor.yml: rules.unpinned-uses.config.policies[%q] має бути %q (ga.mdc)", ["*", expected])
}
