# Test Patterns and Design Techniques

Test design technique examples and application-type-specific test scenarios.

## Table of Contents

- [Test Design Techniques](#test-design-techniques)
- [WebApp Scenarios](#webapp-scenarios)
- [API Server Scenarios](#api-server-scenarios)
- [CLI Tool Scenarios](#cli-tool-scenarios)
- [Library Scenarios](#library-scenarios)
- [Background Service Scenarios](#background-service-scenarios)
- [Security Scenarios (Cross-cutting)](#security-scenarios-cross-cutting)

---

## Test Design Techniques

### Equivalence Partitioning (EP)

Divide inputs into classes where all values in a class should behave the same. Test one representative from each class.

**Example — email field:**
- Valid: `user@example.com` (standard email)
- Invalid class 1: `""` (empty)
- Invalid class 2: `"notanemail"` (missing @)
- Invalid class 3: `"user@"` (missing domain)

**Example — numeric parameter `quantity` (range 1-100):**
- Valid: `5`
- Invalid: `0` (below), `101` (above), `"abc"` (wrong type), `null` (missing)

**Example — file path argument:**
- Valid: `./existing-file.txt` (exists, readable)
- Invalid: `./nonexistent.txt` (missing), `./no-permission.txt` (denied), `./directory/` (wrong kind)

### Boundary Value Analysis (BVA)

Test at exact boundaries: min-1, min, min+1, max-1, max, max+1.

**Example — password (8-16 chars):**
```
7 chars  → REJECT  (min-1)
8 chars  → ACCEPT  (min)
9 chars  → ACCEPT  (min+1)
15 chars → ACCEPT  (max-1)
16 chars → ACCEPT  (max)
17 chars → REJECT  (max+1)
```

**Example — pagination `page` param (1-100):**
```
page=0   → 400  (min-1)
page=1   → 200  (min)
page=100 → 200  (max)
page=101 → 400  (max+1)
```

### State Transition Testing (STT)

Model features as state machines. Test valid transitions, invalid transitions, and guard conditions.

**Example — order lifecycle:**
```
States: draft → submitted → approved → shipped → delivered
                         ↘ rejected

Valid transitions:
  draft → submitted, submitted → approved, submitted → rejected,
  approved → shipped, shipped → delivered

Invalid transitions (must be rejected):
  draft → approved (skip submit)
  shipped → submitted (backward)
  delivered → anything (terminal state)
  rejected → shipped (from rejected)
```

### Pairwise Testing

When multiple parameters interact, test all unique pairs instead of all combinations. Reduces 27 combinations (3×3×3) to ~9 tests.

**Example — viewport × auth role × theme:**

| # | Viewport | Auth | Theme |
|---|----------|------|-------|
| 1 | desktop | admin | light |
| 2 | desktop | user | dark |
| 3 | desktop | anonymous | system |
| 4 | tablet | admin | dark |
| 5 | tablet | user | system |
| 6 | tablet | anonymous | light |
| 7 | mobile | admin | system |
| 8 | mobile | user | light |
| 9 | mobile | anonymous | dark |

---

## WebApp Scenarios

Use the **playwright-cli skill** for test execution. Focus on what to verify:

### Functional
- Page loads with expected content and no console errors
- Form submission: valid input → success state; invalid input → error messages
- Navigation: links, routing, browser back/forward work correctly
- Interactive UI: modals, dropdowns, tabs, accordions open/close correctly
- Data display: lists, tables, pagination render correctly

### Authentication & Authorization
- Protected pages redirect unauthenticated users to login
- Login with valid credentials → redirect to intended page
- Login with invalid credentials → error message, no redirect
- Logout clears session, protected pages become inaccessible
- Role-based access: unauthorized roles see 403 or are redirected

### Input Validation (apply EP + BVA)
- Required fields: empty → error
- Format validation: email, URL, phone number formats
- Length boundaries: min-1, min, max, max+1
- Type constraints: numeric fields reject text

### Edge Cases
- Double-click submit (duplicate submission prevention)
- Empty state (no data loaded yet)
- Very long text input (overflow/truncation handling)
- Responsive: desktop, tablet, mobile viewports
- Refresh during async operations

---

## API Server Scenarios

Use `curl` for test execution.

### CRUD Operations
- Create: POST → 201 with created resource
- Read: GET → 200 with correct data
- Update: PUT/PATCH → 200 with updated fields
- Delete: DELETE → 204/200, subsequent GET → 404
- List: GET with pagination → correct page size and total

### Authentication & Authorization
- No token → 401
- Invalid/expired token → 401 or 403
- Valid token → 200
- Insufficient permissions → 403

### Input Validation (apply EP + BVA)
- Missing required fields → 400 with descriptive error
- Wrong types → 400
- Empty body / malformed JSON → 400
- String length at boundaries
- Numeric parameters at boundaries

### State Transitions
- Invalid state changes → 400/409 with descriptive error
- Valid state changes → success with updated state

### Edge Cases
- Unknown/extra fields in request body (strict vs lenient)
- Very large payload
- Concurrent identical requests (idempotency)
- Content-Type mismatch

---

## CLI Tool Scenarios

Execute commands directly via Bash.

### Basic Operation
- `--help` displays usage information, exits 0
- `--version` displays version, exits 0
- Valid input → expected output on stdout, exits 0
- No arguments → helpful error or usage info

### Error Handling
- Nonexistent input file → error on stderr, non-zero exit
- Invalid flag → error on stderr, non-zero exit
- Permission denied → meaningful error, non-zero exit

### Input Validation (apply EP + BVA)
- Different input sources: file argument, stdin pipe, flags
- Boundary values for numeric flags
- Special characters in arguments (spaces, quotes, unicode)

### Edge Cases
- Empty stdin
- Very large input
- Conflicting flags
- Binary input when text expected

---

## Library Scenarios

Run existing test suite first. Write inline scripts for untested areas.

### Public API
- Each exported function works with valid input
- Invalid/null input → appropriate error or documented behavior
- Return types match documented interface

### Edge Cases
- Empty collections (arrays, objects, strings)
- Null/undefined/None inputs
- Type mismatches
- Large inputs (performance sanity)

---

## Background Service Scenarios

Combine endpoint checks and log inspection.

### Operational
- Health check endpoint returns 200
- Job submission → accepted
- Job completion → result available via status endpoint
- Job failure → error status with meaningful message

### Edge Cases
- Duplicate job submission (idempotency)
- Malformed job payload
- Timeout handling for long-running jobs

---

## Security Scenarios (Cross-cutting)

Apply regardless of application type:

- **XSS**: Submit `<script>alert(1)</script>` in text fields → must be escaped or rejected
- **SQL injection**: `'; DROP TABLE users; --` in query params → no SQL error, parameterized query
- **Path traversal**: `../../../etc/passwd` in file paths → 400 or sanitized
- **Command injection**: `; rm -rf /` in CLI arguments → command not executed
- **Sensitive data**: Passwords, tokens, PII not exposed in responses or logs
- **CORS** (APIs): Appropriate `Access-Control-*` headers
