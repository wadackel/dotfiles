# ast-grep CLI Guide

## CLI Commands

### Inspect Code Structure (--debug-query)

Dump the AST structure to understand how code is parsed:

```bash
ast-grep run --pattern 'async function example() { await fetch(); }' \
  --lang javascript \
  --debug-query=cst
```

**Available formats:**
- `cst`: Concrete Syntax Tree (shows all nodes including punctuation)
- `ast`: Abstract Syntax Tree (shows only named nodes)
- `pattern`: Shows how ast-grep interprets your pattern

**Use this to:**
- Find the correct `kind` values for nodes
- Understand the structure of code you want to match
- Debug why patterns aren't matching

**Example:**
```bash
# See the structure of your target code
ast-grep run --pattern 'class User { constructor() {} }' \
  --lang javascript \
  --debug-query=cst

# See how ast-grep interprets your pattern
ast-grep run --pattern 'class $NAME { $$$BODY }' \
  --lang javascript \
  --debug-query=pattern
```

### Test Rules (scan with --stdin)

Test a rule against code snippet without creating files:

```bash
echo "const x = await fetch();" | ast-grep scan --inline-rules "id: test
language: javascript
rule:
  pattern: await \$EXPR" --stdin
```

**Add --json for structured output:**
```bash
echo "const x = await fetch();" | ast-grep scan --inline-rules "..." --stdin --json
```

### Search with Patterns (run)

Simple pattern-based search for single AST node matches:

```bash
# Basic pattern search
ast-grep run --pattern 'console.log($ARG)' --lang javascript .

# Search specific files
ast-grep run --pattern 'class $NAME' --lang python /path/to/project

# JSON output for programmatic use
ast-grep run --pattern 'function $NAME($$$)' --lang javascript --json .
```

**When to use:**
- Simple, single-node matches
- Quick searches without complex logic
- When you don't need relational rules (inside/has)

### Search with Rules (scan)

YAML rule-based search for complex structural queries:

```bash
# With rule file
ast-grep scan --rule my_rule.yml /path/to/project

# With inline rules
ast-grep scan --inline-rules "id: find-async
language: javascript
rule:
  kind: function_declaration
  has:
    pattern: await \$EXPR
    stopBy: end" /path/to/project

# JSON output
ast-grep scan --rule my_rule.yml --json /path/to/project
```

**When to use:**
- Complex structural searches
- Relational rules (inside, has, precedes, follows)
- Composite logic (all, any, not)
- When you need the power of full YAML rules

**Tip:** For relational rules (inside/has), always add `stopBy: end` to ensure complete traversal.

## Tips for Writing Effective Rules

### Always Use stopBy: end

For relational rules, always use `stopBy: end` unless there's a specific reason not to:

```yaml
has:
  pattern: await $EXPR
  stopBy: end
```

This ensures the search traverses the entire subtree rather than stopping at the first non-matching node.

### Start Simple, Then Add Complexity

Begin with the simplest rule that could work:
1. Try a `pattern` first
2. If that doesn't work, try `kind` to match the node type
3. Add relational rules (`has`, `inside`) as needed
4. Combine with composite rules (`all`, `any`, `not`) for complex logic

### Use the Right Rule Type

- **Pattern**: For simple, direct code matching (e.g., `console.log($ARG)`)
- **Kind + Relational**: For complex structures (e.g., "function containing await")
- **Composite**: For logical combinations (e.g., "function with await but not in try-catch")

### Debug with AST Inspection

When rules don't match:
1. Use `--debug-query=cst` to see the actual AST structure
2. Check if metavariables are being detected correctly
3. Verify the node `kind` matches what you expect
4. Ensure relational rules are searching in the right direction

### Escaping in Inline Rules

When using `--inline-rules`, escape metavariables in shell commands:
- Use `\$VAR` instead of `$VAR` (shell interprets `$` as variable)
- Or use single quotes: `'$VAR'` works in most shells

**Example:**
```bash
# Correct: escaped $
ast-grep scan --inline-rules "rule: {pattern: 'console.log(\$ARG)'}" .

# Or use single quotes
ast-grep scan --inline-rules 'rule: {pattern: "console.log($ARG)"}' .
```

## Common Use Cases

### Find Functions with Specific Content

Find async functions that use await:
```bash
ast-grep scan --inline-rules "id: async-await
language: javascript
rule:
  all:
    - kind: function_declaration
    - has:
        pattern: await \$EXPR
        stopBy: end" /path/to/project
```

### Find Code Inside Specific Contexts

Find console.log inside class methods:
```bash
ast-grep scan --inline-rules "id: console-in-class
language: javascript
rule:
  pattern: console.log(\$\$\$)
  inside:
    kind: method_definition
    stopBy: end" /path/to/project
```

### Find Code Missing Expected Patterns

Find async functions without try-catch:
```bash
ast-grep scan --inline-rules "id: async-no-trycatch
language: javascript
rule:
  all:
    - kind: function_declaration
    - has:
        pattern: await \$EXPR
        stopBy: end
    - not:
        has:
          pattern: try { \$\$\$ } catch (\$E) { \$\$\$ }
          stopBy: end" /path/to/project
```
