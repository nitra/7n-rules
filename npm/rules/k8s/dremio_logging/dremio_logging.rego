# WARN-оверрайди шумних loggerів у logback.xml Dremio Helm-чарту.
#
# Проблема: перелічені нижче FQCN (усі живуть на одному `planning-cache-refresher`
# треді) пишуть INFO-логи на кожен запит/фоновий цикл і домінують обсяг у
# Cloud Logging без діагностичної цінності понад WARN. Вимога: у кожній копії
# vendored-конфігу `dremio_v2/config/logback.xml` (наприклад `dev/…` і `ua/…` —
# кожна env-копія перевіряється окремо, без крос-файлової дедуплікації) має бути
# `<logger name="<FQCN>" level="warn"/>` для кожного FQCN зі списку
# `required_loggers`, з рівнем "warn" або строгішим ("error", "off").
#
# Вхід — XML: conftest інферить парсер за розширенням `.xml`. Конвенція
# представлення (див. `conftest parse`):
#   - атрибути мають префікс "-" (`-name`, `-level`);
#   - один дочірній елемент → об'єкт, кілька → масив. Тому `<logger>`
#     нормалізується у `loggers` (завжди масив).
#
# Запуск (локально):
#   conftest test path/to/dremio_v2/config/logback.xml \
#     -p npm/rules/k8s/dremio_logging \
#     --namespace k8s.dremio_logging
#
# Список FQCN підтверджено живою перевіркою в проді — не розширюй «про запас».
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`.
package k8s.dremio_logging

import rego.v1

# Обов'язкові WARN-оверрайди (FQCN відомо-шумних loggerів Dremio).
required_loggers := {
	"com.dremio.sabot.exec.fragment.FragmentExecutor",
	"com.dremio.sabot.exec.fragment.FragmentStatusReporter",
	"com.dremio.sabot.exec.QueryTicket",
	"com.dremio.service.reflection.descriptor.MaterializationCache",
	"com.dremio.exec.planner.plancache.PlanCacheSynchronizer",
	"com.dremio.exec.planner.plancache.CacheRefresher",
}

# Рівні logback, що задовольняють вимогу «warn або строгіше».
allowed_levels := {"warn", "error", "off"}

# Нормалізація <logger>: один елемент XML-парсер віддає об'єктом, кілька — масивом.
# Тіла взаємовиключні (is_array/is_object), default покриває відсутність елемента
# (зокрема logback.xml без <configuration>-кореня → порожній список → deny на
# кожен обов'язковий FQCN).
default loggers := []

loggers := input.configuration.logger if is_array(input.configuration.logger)

loggers := [input.configuration.logger] if is_object(input.configuration.logger)

# Усі записи <logger> для заданого FQCN (записи без атрибута name пропускаються).
entries_for(name) := [l |
	some l in loggers
	l["-name"] == name
]

# Нормалізований рівень запису; undefined, якщо атрибут level відсутній або не рядок.
entry_level(l) := lower(trim_space(l["-level"])) if is_string(l["-level"])

# Запис задовольняє вимогу: level читається і є warn/error/off.
entry_ok(l) if entry_level(l) in allowed_levels

# FQCN узагалі не має <logger>-оверрайду.
deny contains msg if {
	some name in required_loggers
	count(entries_for(name)) == 0
	msg := sprintf(
		"logback.xml: додай <logger name=\"%s\" level=\"warn\"/> — шумний Dremio-logger заливає Cloud Logging (k8s.mdc)",
		[name],
	)
}

# Оверрайд є, але слабший за warn (info/debug/trace), без level або з не-рядковим
# level. Вимога до КОЖНОГО запису з цим FQCN: дублікати з конфліктними рівнями
# (logback бере останній) — теж порушення, конфіг має бути однозначним.
deny contains msg if {
	some name in required_loggers
	some l in entries_for(name)
	not entry_ok(l)
	msg := sprintf(
		"logback.xml: <logger name=\"%s\"> має рівень %v — постав level=\"warn\" або строгіше (error/off) (k8s.mdc)",
		[name, object.get(l, "-level", "«відсутній»")],
	)
}
