# Coverage

| Область | Рядки | Функції | Вбито мутацій | Score |
| --- | --- | --- | --- | --- |
| JS | 77.23% (6558/8492) | 84.06% (1081/1286) | 93/143 | 65.03% |
| **Разом** | 77.23% (6558/8492) | 84.06% (1081/1286) | 93/143 | 65.03% |

## Вижилі мутанти

```json
[
  {
    "file": "rules/test/coverage/coverage.mjs",
    "mutants": [
      {
        "line": 82,
        "col": 5,
        "mutantType": "StringLiteral",
        "original": "',",
        "replacement": "\"Stryker was here!\""
      },
      {
        "line": 84,
        "col": 5,
        "mutantType": "StringLiteral",
        "original": "| --- | --- | --- | --- | --- |'",
        "replacement": "\"\""
      },
      {
        "line": 95,
        "col": 16,
        "mutantType": "StringLiteral",
        "original": "',",
        "replacement": "\"Stryker was here!\""
      },
      {
        "line": 95,
        "col": 41,
        "mutantType": "StringLiteral",
        "original": "',",
        "replacement": "\"Stryker was here!\""
      },
      {
        "line": 98,
        "col": 18,
        "mutantType": "StringLiteral",
        "original": "',",
        "replacement": "\"Stryker was here!\""
      },
      {
        "line": 98,
        "col": 43,
        "mutantType": "StringLiteral",
        "original": "',",
        "replacement": "\"Stryker was here!\""
      },
      {
        "line": 112,
        "col": 11,
        "mutantType": "ConditionalExpression",
        "original": "roup.recommendationText)",
        "replacement": "true"
      },
      {
        "line": 102,
        "col": 11,
        "mutantType": "ConditionalExpression",
        "original": "roup.exampleTest)",
        "replacement": "false"
      },
      {
        "line": 98,
        "col": 86,
        "mutantType": "StringLiteral",
        "original": "| --- | --- | --- | --- |')",
        "replacement": "\"\""
      },
      {
        "line": 112,
        "col": 11,
        "mutantType": "ConditionalExpression",
        "original": "roup.recommendationText)",
        "replacement": "false"
      },
      {
        "line": 136,
        "col": 7,
        "mutantType": "ConditionalExpression",
        "original": "ypeof mod.detect !== 'function' ",
        "replacement": "false"
      },
      {
        "line": 136,
        "col": 7,
        "mutantType": "LogicalOperator",
        "original": "ypeof mod.detect !== 'function' || typeof mod.collect !== 'function')",
        "replacement": "typeof mod.detect !== 'function' && typeof mod.collect !== 'function'"
      },
      {
        "line": 136,
        "col": 43,
        "mutantType": "ConditionalExpression",
        "original": "ypeof mod.collect !== 'function')",
        "replacement": "false"
      },
      {
        "line": 170,
        "col": 9,
        "mutantType": "ConditionalExpression",
        "original": "onfig.disableRules.includes(ruleId))",
        "replacement": "false"
      },
      {
        "line": 174,
        "col": 17,
        "mutantType": "StringLiteral",
        "original": "→ ${ruleId} coverage…`)",
        "replacement": "``"
      },
      {
        "line": 179,
        "col": 19,
        "mutantType": "StringLiteral",
        "original": "✗ Жодного провайдера покриття не знайдено для активних правил у .n-cursor.json#rules')",
        "replacement": "\"\""
      },
      {
        "line": 185,
        "col": 49,
        "mutantType": "StringLiteral",
        "original": "utf8')",
        "replacement": "\"\""
      },
      {
        "line": 186,
        "col": 15,
        "mutantType": "StringLiteral",
        "original": "✓ COVERAGE.md')",
        "replacement": "\"\""
      },
      {
        "line": 188,
        "col": 7,
        "mutantType": "ConditionalExpression",
        "original": "pts.fix)",
        "replacement": "false"
      }
    ],
    "exampleTest": {
      "testFile": "rules/test/coverage/tests/coverage.test.mjs",
      "code": "  test('покомпонентне додавання lines та functions', () => {\n    const a = { lines: { covered: 10, total: 20 }, functions: { covered: 3, total: 5 } }\n    const b = { lines: { covered: 5, total: 8 }, functions: { covered: 2, total: 4 } }\n    expect(addCoverage(a, b)).toEqual({\n      lines: { covered: 15, total: 28 },\n      functions: { covered: 5, total: 9 }\n    })\n  })"
    },
    "recommendationText": null
  }
]
```

### rules/test/coverage/coverage.mjs

| Рядок | Оригінал | Заміна | Тип |
| --- | --- | --- | --- |
| 82 | `',` | `"Stryker was here!"` | StringLiteral |
| 84 | `| --- | --- | --- | --- | --- |'` | `""` | StringLiteral |
| 95 | `',` | `"Stryker was here!"` | StringLiteral |
| 95 | `',` | `"Stryker was here!"` | StringLiteral |
| 98 | `',` | `"Stryker was here!"` | StringLiteral |
| 98 | `',` | `"Stryker was here!"` | StringLiteral |
| 112 | `roup.recommendationText)` | `true` | ConditionalExpression |
| 102 | `roup.exampleTest)` | `false` | ConditionalExpression |
| 98 | `| --- | --- | --- | --- |')` | `""` | StringLiteral |
| 112 | `roup.recommendationText)` | `false` | ConditionalExpression |
| 136 | `ypeof mod.detect !== 'function' ` | `false` | ConditionalExpression |
| 136 | `ypeof mod.detect !== 'function' || typeof mod.collect !== 'function')` | `typeof mod.detect !== 'function' && typeof mod.collect !== 'function'` | LogicalOperator |
| 136 | `ypeof mod.collect !== 'function')` | `false` | ConditionalExpression |
| 170 | `onfig.disableRules.includes(ruleId))` | `false` | ConditionalExpression |
| 174 | `→ ${ruleId} coverage…`)` | ```` | StringLiteral |
| 179 | `✗ Жодного провайдера покриття не знайдено для активних правил у .n-cursor.json#rules')` | `""` | StringLiteral |
| 185 | `utf8')` | `""` | StringLiteral |
| 186 | `✓ COVERAGE.md')` | `""` | StringLiteral |
| 188 | `pts.fix)` | `false` | ConditionalExpression |

**Приклад тесту** (`rules/test/coverage/tests/coverage.test.mjs`):

```js
  test('покомпонентне додавання lines та functions', () => {
    const a = { lines: { covered: 10, total: 20 }, functions: { covered: 3, total: 5 } }
    const b = { lines: { covered: 5, total: 8 }, functions: { covered: 2, total: 4 } }
    expect(addCoverage(a, b)).toEqual({
      lines: { covered: 15, total: 28 },
      functions: { covered: 5, total: 9 }
    })
  })
```
