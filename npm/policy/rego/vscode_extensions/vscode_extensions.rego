# Перевірка `.vscode/extensions.json` для rego (rego.mdc).
#
# Викликається з `check-rego.mjs` через `runConftestBatch` лише ПІСЛЯ того, як
# JS виявив `.rego` файли у дереві (умовне правило — проєкти без rego не
# зобовʼязані ставити tsandall.opa). Глобально у `lint-conftest` НЕ
# реєструється.
#
# Canonical (rego.mdc): `recommendations` має містити `tsandall.opa`.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
package rego.vscode_extensions

import rego.v1

deny contains msg if {
	recs := object.get(input, "recommendations", [])
	not "tsandall.opa" in {r | some r in recs}
	msg := ".vscode/extensions.json: recommendations має містити \"tsandall.opa\" (rego.mdc)"
}
