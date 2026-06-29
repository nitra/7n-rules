# Структурна перевірка опт-аут конфігу для image-avif у `package.json` (image-avif.mdc).
#
# Канон надходить через --data: { "template": { "deny": ... } }
# Структура --data сформована з template/package.json.deny.json:
# `<field>.<typo_key>` — нелегітимні (typo) ключі під опт-аут конфігом.
#
# Inverse type-перевірки (поле має бути обʼєктом, `disable-avif` — boolean) лишаються
# inline у rego, бо це не лежить на template-pattern (це інверс типу, не deny-key).
# FS / behavior (запуск `npx @nitra/minify-image`, walk `.vue`, видалення AVIF-сиріт) — у JS.
package image_avif.package_json

import rego.v1

# ── deny: typo-keys (template-driven) ────────────────────────────────────

deny contains msg if {
	some field, typo_map in data.template.deny
	cfg := object.get(input, field, null)
	is_object(cfg)
	some typo_key, reason in typo_map
	typo_key in object.keys(cfg)
	msg := sprintf("package.json: ключ \"%s.%s\" — %s", [field, typo_key, reason])
}

# ── deny: тип поля (inverse — лишається в rego) ──────────────────────────

deny contains msg if {
	some field, _ in data.template.deny
	value := object.get(input, field, null)
	value != null
	not is_object(value)
	msg := sprintf("package.json: поле \"%s\" має бути обʼєктом (зараз: %v) (image-avif.mdc)", [field, value])
}

# ── deny: тип disable-avif (inverse — лишається в rego, hardcoded key) ──

deny contains msg if {
	cfg := object.get(input, "@nitra/minify-image", {})
	is_object(cfg)
	value := object.get(cfg, "disable-avif", null)
	value != null
	not is_boolean(value)
	msg := sprintf(
		"package.json: \"@nitra/minify-image.disable-avif\" має бути boolean (зараз: %v) (image-avif.mdc)",
		[value],
	)
}
