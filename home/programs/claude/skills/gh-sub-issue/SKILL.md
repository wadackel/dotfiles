---
name: gh-sub-issue
description: |
  Manage GitHub Sub-Issues via GraphQL API. Supports full CRUD: create, add existing,
  list, remove, and reorder sub-issues.
  Use when asked to: "add sub-issue", "create child issue", "list sub-issues",
  "remove sub-issue", "reorder sub-issues", "sub-issueを追加", "子イシューを作成",
  "サブイシューの一覧", "サブイシューを外す", "サブイシューを並び替え",
  "break down issue", "issue hierarchy", or any sub-issue management task.
argument-hint: "<parent-issue-url>"
---

# Sub-Issue

Manage GitHub Sub-Issues using the `gh` CLI with GraphQL API.

## Quick Start

```
/gh-sub-issue https://github.com/owner/repo/issues/4
/gh-sub-issue owner/repo#4
```

Without arguments, Claude will ask for the parent issue URL.

## Argument Parsing

Parse `$ARGUMENTS` to extract the parent issue:

- Full URL: `https://github.com/owner/repo/issues/N` → owner=`owner`, repo=`repo`, number=`N`
- Shorthand: `owner/repo#N` → owner=`owner`, repo=`repo`, number=`N`

If `$ARGUMENTS` is empty or unparseable, ask the user for the parent issue URL.

## Prerequisites

- `gh` CLI authenticated (`gh auth status`)
- Repository must have GitHub Sub-Issues enabled (available on certain GitHub plans)

## Operations

### Step 0: Select Operation

Determine the operation from conversational context or `$ARGUMENTS`:

| User intent | Operation |
|-------------|-----------|
| "create new sub-issue", "add sub-issue", "子イシューを作成" | → Create and Add |
| "attach/link existing issue", "既存のissueを追加" | → Add Existing Issue |
| "list/show sub-issues", "サブイシュー一覧" | → List |
| "remove/unlink/detach sub-issue", "サブイシューを外す" | → Remove |
| "reorder/move sub-issue", "並び替え" | → Reorder |

If only a parent issue URL is provided with no clear operation, ask the user which operation they want.

### Create and Add Sub-Issue

Create a new issue and immediately attach it as a sub-issue.

1. Gather from context or ask the user:
   - **Title** (required)
   - **Body** (optional — defaults to empty string if not provided)
   - **Labels, assignees, milestone** (optional — pass through if provided)

2. Create the issue:

   If body is provided, write it to a temporary file using the **Write** tool:
   - File path: `/tmp/gh-sub-issue-body-<random>.md` (short random suffix to avoid conflicts)

   Then create the issue:
   ```bash
   # With body (via temp file)
   CHILD_URL=$(gh issue create -R owner/repo \
     --title "TITLE" \
     --body-file /tmp/gh-sub-issue-body-<random>.md \
     [--label "LABEL"] \
     [--assignee "USER"])

   # Without body
   CHILD_URL=$(gh issue create -R owner/repo \
     --title "TITLE" \
     --body "" \
     [--label "LABEL"] \
     [--assignee "USER"])
   ```
   Capture the returned URL from stdout.

3. Get the parent issue node ID:
   ```bash
   gh api graphql -f query='{ repository(owner:"OWNER", name:"REPO") { issue(number:N) { id title } } }'
   ```

4. Link as sub-issue:
   ```bash
   gh api graphql -f query='mutation { addSubIssue(input: { issueId:"PARENT_NODE_ID", subIssueUrl:"CHILD_URL" }) { subIssue { number title url } } }'
   ```

5. Report the created sub-issue URL.

6. Clean up the temporary body file if one was created:
   ```bash
   rm /tmp/gh-sub-issue-body-<random>.md
   ```

**On failure after step 2**: Display the created issue URL so the user can manually link or delete it (orphan recovery). Still clean up the temporary file if it was created.

### Add Existing Issue as Sub-Issue

Attach an existing issue to a parent without creating a new one.

1. Get the child issue URL from context or ask the user.

2. Get the parent issue node ID (same query as above).

3. Link:
   ```bash
   gh api graphql -f query='mutation { addSubIssue(input: { issueId:"PARENT_NODE_ID", subIssueUrl:"CHILD_URL" }) { subIssue { number title url } } }'
   ```

4. **If the child already has a parent**: Ask the user whether to re-parent it.
   - If yes, add `replaceParent: true` to the mutation input.
   - Default: `replaceParent: false` (mutation will fail without explicit confirmation).

### List Sub-Issues

Show all sub-issues for the parent issue.

```bash
gh api graphql -f query='{ repository(owner:"OWNER", name:"REPO") { issue(number:N) { subIssues(first:50) { totalCount nodes { id number title state url } } subIssuesSummary { total completed percentCompleted } } } }'
```

Display results as a numbered list with state indicators. Show `subIssuesSummary` (X/Y completed, Z%).

If `totalCount > 50`, warn the user that results are truncated at 50.

### Remove Sub-Issue

Detach a sub-issue from its parent (does not delete the issue).

1. Run the List operation to show current sub-issues with their node IDs.

2. Ask the user which sub-issue to remove (by number or title).

3. Remove:
   ```bash
   gh api graphql -f query='mutation { removeSubIssue(input: { issueId:"PARENT_NODE_ID", subIssueId:"CHILD_NODE_ID" }) { subIssue { number title } } }'
   ```

4. Confirm the removal.

### Reorder Sub-Issues

Change the display order of sub-issues under a parent.

1. Run the List operation to show current sub-issues with positions (1, 2, 3...) and node IDs.

2. Ask the user:
   - Which sub-issue to move (by number or title)
   - Where to place it (after which sub-issue, or at the top)

3. Reorder:
   ```bash
   # Place after a specific sub-issue
   gh api graphql -f query='mutation { reprioritizeSubIssue(input: { issueId:"PARENT_NODE_ID", subIssueId:"CHILD_NODE_ID", afterId:"AFTER_NODE_ID" }) { subIssue { number title } } }'

   # Place at the top (omit afterId/beforeId, or use beforeId of first item)
   gh api graphql -f query='mutation { reprioritizeSubIssue(input: { issueId:"PARENT_NODE_ID", subIssueId:"CHILD_NODE_ID" }) { subIssue { number title } } }'
   ```

4. Run the List operation again to confirm the new order.

## GraphQL Reference

All operations use `gh api graphql -f query='...'`. Replace `OWNER`, `REPO`, `N`, and node IDs with actual values.

```bash
# Get node ID (parent or child)
gh api graphql -f query='{ repository(owner:"OWNER", name:"REPO") { issue(number:N) { id } } }'

# Add sub-issue
gh api graphql -f query='mutation { addSubIssue(input: { issueId:"PARENT_NODE_ID", subIssueUrl:"ISSUE_URL" }) { subIssue { number title url } } }'

# Add sub-issue with re-parent
gh api graphql -f query='mutation { addSubIssue(input: { issueId:"PARENT_NODE_ID", subIssueUrl:"ISSUE_URL", replaceParent:true }) { subIssue { number title url } } }'

# List sub-issues
gh api graphql -f query='{ repository(owner:"OWNER", name:"REPO") { issue(number:N) { subIssues(first:50) { totalCount nodes { id number title state url } } subIssuesSummary { total completed percentCompleted } } } }'

# Remove sub-issue
gh api graphql -f query='mutation { removeSubIssue(input: { issueId:"PARENT_NODE_ID", subIssueId:"CHILD_NODE_ID" }) { subIssue { number title } } }'

# Reorder sub-issue (place after a specific sub-issue)
gh api graphql -f query='mutation { reprioritizeSubIssue(input: { issueId:"PARENT_NODE_ID", subIssueId:"CHILD_NODE_ID", afterId:"AFTER_NODE_ID" }) { subIssue { number title } } }'
```

## Error Handling

| Error | Action |
|-------|--------|
| Invalid parent URL format | Validate before API call; show expected format |
| Sub-Issues not enabled on repo | Display GraphQL error + note: "Sub-Issues requires certain GitHub plans/organizations" |
| `gh issue create` succeeded but `addSubIssue` failed | Show the created issue URL for manual linking or deletion |
| Child issue already has a parent | Ask whether to re-parent (`replaceParent: true`) |
| Authentication / permission error | Run `gh auth status` and prompt the user to check access |
