# Dart / Flutter review card
Trigger: `.dart` among the changed files.
Scope: null safety, widget rebuilds, lifecycle and async for `code-reviewer`.

## Check
**Null safety**
- `!` only where safety is proven by the surrounding code, not by "works in tests"; `late` fields set before first access, `late final` when never reassigned.
- `required` on named parameters the widget cannot render without; a default value over a nullable when the semantics allow.
**Rebuilds and state**
- `const` constructors and `const` subtrees in `build`; `ValueKey` / `ObjectKey` on list items that reorder.
- Work in `build()` that belongs in `initState()` (network calls, controller creation); `setState` reachable from `build` (infinite loop).
- `Selector` / `Consumer` scoped to the smallest subtree; `InheritedWidget` / `Provider` not used for high-frequency updates.
- One state-management pattern per layer unless a reason is stated.
**Lifecycle and async**
- `dispose()` cancels every `StreamSubscription` and `Timer`, and disposes `TextEditingController`, `FocusNode`, `AnimationController`; `WidgetsBindingObserver` removed.
- An `async` function that swallows errors; a `Future` neither awaited nor `unawaited(...)`.
- `FutureBuilder` / `StreamBuilder` handle loading, error and empty states.
**Platform channels**
- Native exceptions mapped to Dart exceptions, not swallowed as `null`; `MissingPluginException` handled; channel names namespaced.

## Do not flag
- Missing `const` on a subtree that cannot be const (depends on runtime values).
- Pattern choice (Provider vs Riverpod vs Bloc) when the app already uses one consistently.
