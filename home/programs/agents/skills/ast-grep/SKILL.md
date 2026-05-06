---
name: ast-grep
description: Translates natural language queries into ast-grep YAML rules for structural code search using Abstract Syntax Tree (AST) patterns. Use when asked to "find code patterns", "search for specific language constructs", "AST search", "structural search", "ast-grepで検索", "コードパターンを探して", "構造的に検索して", or when text-based grep is insufficient for matching code structure (e.g., "find all async functions that don't handle errors", "find all calls to X inside class Y").
---

# ast-grep Code Search

## Overview

Translates natural language queries into ast-grep rules for structural code search. ast-grep uses Abstract Syntax Tree (AST) patterns to match code based on its structure rather than just text, enabling powerful and precise code search across large codebases.

## General Workflow

### Step 1: Understand the Query

Clearly understand what the user wants to find. Ask clarifying questions if needed:
- What specific code pattern or structure are they looking for?
- Which programming language?
- Are there specific edge cases or variations to consider?
- What should be included or excluded from matches?

### Step 2: Create Example Code

Write a simple code snippet that represents what the user wants to match. Save this to a temporary file for testing.

**Example:**
If searching for "async functions that use await", create a test file:

```javascript
// test_example.js
async function example() {
  const result = await fetchData();
  return result;
}
```

### Step 3: Write the ast-grep Rule

Translate the pattern into an ast-grep rule. Start simple and add complexity as needed.

**Key principles:**
- Always use `stopBy: end` for relational rules (`inside`, `has`) to ensure search goes to the end of the direction
- Use `pattern` for simple structures
- Use `kind` with `has`/`inside` for complex structures
- Break complex queries into smaller sub-rules using `all`, `any`, or `not`

**Example rule file (test_rule.yml):**
```yaml
id: async-with-await
language: javascript
rule:
  kind: function_declaration
  has:
    pattern: await $EXPR
    stopBy: end
```

See `references/rule_reference.md` for comprehensive rule documentation and `references/cli-guide.md` for CLI commands and tips.

### Step 4: Test the Rule

Use ast-grep CLI to verify the rule matches the example code. There are two main approaches:

**Option A: Test with inline rules (for quick iterations)**
```bash
echo "async function test() { await fetch(); }" | ast-grep scan --inline-rules "id: test
language: javascript
rule:
  kind: function_declaration
  has:
    pattern: await \$EXPR
    stopBy: end" --stdin
```

**Option B: Test with rule files (recommended for complex rules)**
```bash
ast-grep scan --rule test_rule.yml test_example.js
```

**Debugging if no matches:**
1. Simplify the rule (remove sub-rules)
2. Add `stopBy: end` to relational rules if not present
3. Use `--debug-query` to understand the AST structure (see cli-guide.md)
4. Check if `kind` values are correct for the language

**Common errors:**
- `duplicate field 'has'` or `duplicate field 'inside'`: You cannot have multiple `has` or `inside` at the same level in YAML. Use `all` to group them:
  ```yaml
  rule:
    all:
      - has: { pattern: await $EXPR, stopBy: end }
      - has: { kind: formal_parameters, stopBy: end }
  ```

### Step 5: Search the Codebase

Once the rule matches the example code correctly, search the actual codebase:

**For simple pattern searches:**
```bash
ast-grep run --pattern 'console.log($ARG)' --lang javascript /path/to/project
```

**For complex rule-based searches:**
```bash
ast-grep scan --rule my_rule.yml /path/to/project
```

**For inline rules (without creating files):**
```bash
ast-grep scan --inline-rules "id: my-rule
language: javascript
rule:
  pattern: \$PATTERN" /path/to/project
```

## References

- `references/rule_reference.md`: Comprehensive ast-grep rule documentation (atomic, relational, composite rules, metavariables)
- `references/cli-guide.md`: CLI commands, tips for writing effective rules, and common use case examples

Load these references when detailed rule syntax or CLI guidance is needed.
