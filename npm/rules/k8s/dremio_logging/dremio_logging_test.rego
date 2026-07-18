# Тести для `k8s.dremio_logging`. Запуск:
#   conftest verify -p npm/rules/k8s/dremio_logging
#
# Фікстури відтворюють представлення XML-парсера conftest: атрибути з префіксом
# "-"; один <logger> — об'єкт, кілька — масив.
package k8s.dremio_logging_test

import rego.v1

import data.k8s.dremio_logging

executor_fqcn := "com.dremio.sabot.exec.fragment.FragmentExecutor"

# Валідний запис <logger name="…" level="warn"/> для FQCN.
warn_logger(name) := {"-name": name, "-level": "warn"}

# Усі шість обов'язкових оверрайдів з level="warn".
all_warn := [warn_logger(name) | some name in dremio_logging.required_loggers]

# Мінімальний валідний logback.xml після conftest parse.
with_loggers(l) := {"configuration": {
	"appender": {"-name": "console", "-class": "ch.qos.logback.core.ConsoleAppender"},
	"logger": l,
	"root": {"-level": "info", "appender-ref": {"-ref": "console"}},
}}

# Заміна запису для executor_fqcn на довільний об'єкт-оверрайд.
with_executor(entry) := with_loggers(array.concat(
	[l | some l in all_warn; l["-name"] != executor_fqcn],
	[entry],
))

test_allow_all_required_warn if {
	count(dremio_logging.deny) == 0 with input as with_loggers(all_warn)
}

# Порожній <configuration> без loggerів → deny на кожен із шести FQCN.
test_deny_empty_configuration_lists_all if {
	count(dremio_logging.deny) == 6 with input as {"configuration": {}}
}

# Файл без <configuration>-кореня (зіпсований logback.xml) → теж усі шість.
test_deny_no_configuration_root if {
	count(dremio_logging.deny) == 6 with input as {}
}

# Бракує одного FQCN → рівно одне порушення, і воно називає цей FQCN.
test_deny_one_missing_names_fqcn if {
	missing_one := [l | some l in all_warn; l["-name"] != executor_fqcn]
	denies := dremio_logging.deny with input as with_loggers(missing_one)
	count(denies) == 1
	some msg in denies
	contains(msg, executor_fqcn)
}

# Один <logger> у файлі → XML-парсер віддає об'єкт, не масив: нормалізація
# приймає його (deny лише про п'ять відсутніх, не про цей).
test_single_logger_object_form if {
	denies := dremio_logging.deny with input as with_loggers(warn_logger(executor_fqcn))
	count(denies) == 5
	every msg in denies { not contains(msg, executor_fqcn) }
}

test_deny_level_info if {
	count(dremio_logging.deny) == 1 with input as with_executor({"-name": executor_fqcn, "-level": "info"})
}

test_deny_level_missing if {
	count(dremio_logging.deny) == 1 with input as with_executor({"-name": executor_fqcn})
}

# Рівень читається case-insensitive і з обрізанням пробілів.
test_allow_level_uppercase_warn if {
	count(dremio_logging.deny) == 0 with input as with_executor({"-name": executor_fqcn, "-level": "WARN"})
}

test_allow_level_padded_warn if {
	count(dremio_logging.deny) == 0 with input as with_executor({"-name": executor_fqcn, "-level": " warn "})
}

# «Строгіше за warn» — error та off теж задовольняють.
test_allow_level_error if {
	count(dremio_logging.deny) == 0 with input as with_executor({"-name": executor_fqcn, "-level": "error"})
}

test_allow_level_off if {
	count(dremio_logging.deny) == 0 with input as with_executor({"-name": executor_fqcn, "-level": "OFF"})
}

# Дублікати одного FQCN з конфліктними рівнями (logback бере останній) —
# слабший запис флагується: конфіг має бути однозначним.
test_deny_duplicate_conflicting_levels if {
	dup := array.concat(all_warn, [{"-name": executor_fqcn, "-level": "debug"}])
	count(dremio_logging.deny) == 1 with input as with_loggers(dup)
}

# Додаткові необов'язкові loggerи з будь-яким рівнем — не порушення.
test_allow_extra_logger_any_level if {
	extra := array.concat(all_warn, [{"-name": "com.example.Other", "-level": "debug"}])
	count(dremio_logging.deny) == 0 with input as with_loggers(extra)
}

# Запис без атрибута name ігнорується нормалізацією (не матчить жоден FQCN).
test_logger_without_name_ignored if {
	extra := array.concat(all_warn, [{"-level": "debug"}])
	count(dremio_logging.deny) == 0 with input as with_loggers(extra)
}
