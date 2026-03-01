# Codex MCP — Configuration Reference

## Sandbox modes

| Mode | Use case | Description |
|------|----------|-------------|
| `read-only` | Plan review | No filesystem changes |
| `workspace-write` | Code review + auto-fix | Allow file changes in workspace |
| `danger-full-access` | System-wide changes | Not recommended (rarely needed) |

## Approval policies

| Policy | Use case | Description |
|--------|----------|-------------|
| `on-failure` | Normal review | Confirm only on failures (recommended) |
| `on-request` | Strict review | Confirm all operations |
| `never` | Full automation | No user confirmation (use with caution) |

## Recommended settings

**Plan review:**
```javascript
{
  sandbox: "read-only",
  "approval-policy": "on-failure"
}
```

**Code review with auto-fix:**
```javascript
{
  sandbox: "workspace-write",
  "approval-policy": "on-failure"
}
```

**Security audit:**
```javascript
{
  sandbox: "workspace-write",
  "approval-policy": "on-request"
}
```
