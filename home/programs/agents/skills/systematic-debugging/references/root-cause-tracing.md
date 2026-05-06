# Root Cause Tracing

## Overview

Bugs often manifest deep in the call stack — a function receives bad input,
a file gets created in the wrong directory, a query returns unexpected results.
The instinct is to fix where the error appears, but that treats the symptom.

Fixing where the error appears treats the symptom; tracing back to the
original trigger fixes the disease.

## When to Use

- Error happens deep in execution (not at entry point)
- Stack trace shows a long call chain
- Unclear where invalid data originated
- Need to find which test or code path triggers the problem

## The Tracing Process

### 1. Observe the Symptom

Start with what you can see — the error message, the wrong output, the
unexpected state.

```
Error: ENOENT: no such file or directory '/tmp/build/output.js'
```

### 2. Find Immediate Cause

What code directly produces this error? This is the starting point,
not the fix point.

```typescript
await fs.readFile(outputPath); // outputPath is wrong
```

### 3. Ask "What Called This?"

Trace one level up. Who passed the bad value?

```typescript
buildProject(config)
  -> generateOutput(config.outputDir)  // config.outputDir is empty string
    -> fs.readFile(path.join(outputDir, 'output.js'))
```

### 4. Keep Tracing Up

Follow the bad value through each layer. At each level ask:
"Where did this value come from?"

```typescript
loadConfig()           // Returns { outputDir: '' }
  -> buildProject(config)
    -> generateOutput(config.outputDir)
      -> fs.readFile(...)  // Error manifests here
```

The bad value originated in `loadConfig()`, four levels above where
the error appeared.

### 5. Find Original Trigger

The original trigger is where the bad value first enters the system.
Fix here, not at the symptom point.

```typescript
// Root cause: loadConfig() reads from env var that isn't set
function loadConfig() {
  return {
    outputDir: process.env.BUILD_OUTPUT || '' // Empty fallback
  };
}
```

**Fix at source:** Validate early, fail fast with a clear error message.

## Adding Stack Traces for Investigation

When manual tracing is difficult, add temporary instrumentation before
the problematic operation. This investment pays off immediately — one
instrumented run often reveals the entire call chain.

```typescript
async function buildOutput(directory: string) {
  const stack = new Error().stack;
  console.error('DEBUG buildOutput:', {
    directory,
    cwd: process.cwd(),
    stack,
  });
  // ... original code
}
```

Use `console.error()` in tests (not a logger — loggers may be suppressed
in test environments).

Run and capture:

```bash
npm test 2>&1 | grep 'DEBUG buildOutput'
```

Analyze stack traces looking for:
- Test file names (which test triggers the problem?)
- Line numbers (which code path?)
- Patterns (same parameter? same caller?)

## Finding Which Test Causes Pollution

If something appears during tests but you don't know which test is
responsible, use a bisection approach:

1. Run the first half of the test suite, check for the side effect
2. If present, the polluter is in the first half — split again
3. If absent, the polluter is in the second half — split again
4. Repeat until you find the single test

This is O(log n) — for 100 tests, you need ~7 runs to find the polluter.

## Key Principle

```
Found immediate cause
  -> Can trace one level up? -> YES -> Trace backwards
    -> Is this the source? -> NO -> Keep tracing
    -> Is this the source? -> YES -> Fix at source
                                  -> Add validation at each layer
```

Fix at the source. Then add validation at intermediate layers so the
same class of bad input is caught early in the future.

## Stack Trace Tips

- **In tests:** Use `console.error()` not logger — logger output may be suppressed
- **Timing:** Log before the dangerous operation, not after it fails
- **Include context:** Directory, cwd, environment variables, timestamps
- **Capture stack:** `new Error().stack` shows the complete call chain
