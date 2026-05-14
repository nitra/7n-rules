# Порт перевірки `checkBunfigHoisted` з `npm/scripts/check-bun.mjs` (bun.mdc).
#
# Запуск (локально):
#   conftest test bunfig.toml -p npm/policy/bun --namespace bun.bunfig
#
# Conftest парсить `.toml` нативно: секція `[install]` стає обʼєктом `input.install`.
# FS-перевірки (наявність самого `bunfig.toml`, `bun.lock`, заборонені lockfile-и
# `package-lock.json` тощо, директорія `.yarn/`) живуть у `check-bun.mjs` — Rego
# працює лише з вже завантаженим input.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package bun.bunfig

import rego.v1

deny contains msg if {
	# `object.get(…, false)` дає визначене значення, коли поля немає, інакше
	# `not is_object(input.install)` повернув би `undefined`, і правило мовчки
	# не спрацювало б (той самий патерн, що й у `ga.workflow_common`).
	not is_object(object.get(input, "install", false))
	msg := "bunfig.toml: відсутня секція [install] (bun.mdc)"
}

deny contains msg if {
	is_object(object.get(input, "install", false))

	# `object.get(…, null)` робить значення визначеним, інакше при відсутньому
	# `linker` порівняння `!= "hoisted"` дало б `undefined`, не `true`.
	object.get(input.install, "linker", null) != "hoisted"
	msg := "bunfig.toml: у секції [install] має бути linker = \"hoisted\" (bun.mdc)"
}
