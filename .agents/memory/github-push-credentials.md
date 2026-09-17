---
name: GitHub push credentials
description: Environment-specific handling for pushing to GitHub without OAuth.
---

Use the Replit Secrets manager for a GitHub token. In this workspace, the token
was confirmed to exist but was not consistently injected into interactive
ShellExec or CodeExecution shell sessions. A temporary console workflow could
receive the secret, push via an ephemeral Git credential helper, verify the
remote commit, and then be removed.

**Why:** Keeping the token out of chat, files, Git configuration, and long-lived
workflows prevents accidental disclosure while still allowing HTTPS pushes.

**How to apply:** If the same injection mismatch occurs, use a short-lived
workflow only for the authenticated Git operation, print no credential values,
verify local and remote refs, and remove the workflow immediately.