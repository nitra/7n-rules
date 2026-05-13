# Структурна перевірка опт-аут конфігу для image-avif у `package.json` (image-avif.mdc).
#
# Запуск (локально):
#   conftest test <pkg>/package.json -p npm/policy/image_avif/package_json \
#     --namespace image_avif.package_json
#
# Канонічна форма опт-ауту з image-avif.mdc:
#   { "@nitra/minify-image": { "disable-avif": true } }
#
# Поле опційне — більшість проєктів його не мають. Полісі deny лише, якщо поле
# присутнє, але має нелегітимну форму: типовий typo (`disabled-avif`) або
# неправильний тип (`"disable-avif": "yes"`). Без цієї перевірки помилкове
# написання тихо повертає AVIF-генерацію всередину пакета, де її хотіли вимкнути.
#
# FS / behavior (запуск `npx @nitra/minify-image`, walk `.vue`, видалення AVIF-сиріт) — у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package image_avif.package_json

import rego.v1

minify_image_field := "@nitra/minify-image"

# ── deny: значення поля має бути обʼєктом, якщо присутнє ──────────────────

deny contains msg if {
	value := object.get(input, minify_image_field, null)
	value != null
	not is_object(value)
	msg := sprintf(
		"package.json: поле \"@nitra/minify-image\" має бути обʼєктом (зараз: %v) (image-avif.mdc)",
		[value],
	)
}

# ── deny: відомі ключі мають правильний тип ──────────────────────────────

deny contains msg if {
	cfg := object.get(input, minify_image_field, {})
	is_object(cfg)
	value := object.get(cfg, "disable-avif", null)
	value != null
	not is_boolean(value)
	msg := sprintf(
		"package.json: \"@nitra/minify-image.disable-avif\" має бути boolean (зараз: %v) (image-avif.mdc)",
		[value],
	)
}

# ── deny: захист від typo `disabled-avif` ────────────────────────────────

deny contains msg if {
	cfg := object.get(input, minify_image_field, {})
	is_object(cfg)
	"disabled-avif" in object.keys(cfg)
	msg := concat(" ", [
		"package.json: ключ \"@nitra/minify-image.disabled-avif\" виглядає як typo —",
		"канонічна назва \"disable-avif\" (image-avif.mdc)",
	])
}
