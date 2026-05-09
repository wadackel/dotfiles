---
name: bypass-plan-gate
description: Use only when the user explicitly invokes `$bypass-plan-gate` to request the Codex plan gate bypass for the current session and cwd. This skill is a discoverability wrapper; activation is owned by the UserPromptSubmit hook, not by the skill body.
---

# $bypass-plan-gate

## Purpose

Make `$bypass-plan-gate` discoverable as an explicit Codex skill while preserving hook-owned bypass activation.

## Activation Boundary

This skill must not create, edit, delete, or validate bypass markers directly.

Marker creation is owned by `codex-bypass-plan-gate-tracker.ts`.
Marker validation is owned by `codex-plan-gate.ts`.
AI-internal skill execution is not an approval signal.

## Invocation Behavior

If the user invokes only `$bypass-plan-gate`, respond that `$bypass-plan-gate` was requested and that the UserPromptSubmit hook owns activation. Ask for the concrete edit request next.

If the user invokes `$bypass-plan-gate` with a concrete edit request, keep any work limited to that request. Do not say bypass mode is active; let the edit gate outcome determine whether edits are allowed.

## Safety

Even when bypass is requested, keep edits limited to the user's explicit request and run relevant verification.

Do not use shell file writes or generated write commands to route around the plan gate.
