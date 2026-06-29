# Перевірка кореневого `package.json` abie-проєкту: у `devDependencies` має бути
# `@nitra/abie-shared` (контракти/схеми/скіли abie-сервісів — наприклад
# `node_modules/@nitra/abie-shared/...`). Версію не фіксуємо — лише presence.
#
# Inverse-presence перевірка — лишається inline у rego (як `@nitra/cspell-dict`
# у `text.package_json`), бо у template/ зберігаємо позитивні snippet/deny канони,
# а не одиничний required-ключ.
package abie.package_json_shared

import rego.v1

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	not "@nitra/abie-shared" in object.keys(dev)
	msg := "package.json: devDependencies має містити @nitra/abie-shared — bun add -d @nitra/abie-shared (abie.mdc)"
}
