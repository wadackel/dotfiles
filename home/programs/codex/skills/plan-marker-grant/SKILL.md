---
name: plan-marker-grant
description: Use only when the user explicitly invokes `$plan-marker-grant` to grant the Codex plan-gate marker for the current session and cwd. This skill is a discoverability wrapper; activation is owned by the UserPromptSubmit hook, not by the skill body.
---

# $plan-marker-grant

## Purpose

Make `$plan-marker-grant` discoverable as an explicit Codex skill while preserving hook-owned marker activation.

> **Internal naming note**: marker basename on disk (`.bypass-plan-gate-<hash>-<hash>.json`) and internal symbols in `codex-plan-gate.ts` (`BypassMarker*`, `bypassMarkerInfo`, `activateBypassMarker`, `hasValidBypassMarker`) plus the tracker's `BYPASS_REGEX` / `activateBypass` / `isBypassPrompt` / `BypassResult` still use the original `bypass-plan-gate` identifier. The rename targets only user-facing names (skill name, prompt token, tracker filename, log basename). This intentional inconsistency keeps the change surgical and avoids stranding active markers held by in-flight sessions. Do not "fix" the mismatch — it is load-bearing.

## Activation Boundary

This skill must not create, edit, delete, or validate plan-gate markers directly.

Marker creation is owned by `codex-plan-marker-grant-tracker.ts`.
Marker validation is owned by `codex-plan-gate.ts`.
AI-internal skill execution is not an approval signal.

## Invocation Behavior

If the user invokes only `$plan-marker-grant`, respond that `$plan-marker-grant` was requested and that the UserPromptSubmit hook owns activation. Ask for the concrete edit request next.

If the user invokes `$plan-marker-grant` with a concrete edit request, keep any work limited to that request. Do not say the marker is active; let the edit gate outcome determine whether edits are allowed.

## Safety

Even when the marker is requested, keep edits limited to the user's explicit request and run relevant verification.

Do not use shell file writes or generated write commands to route around the plan gate.
