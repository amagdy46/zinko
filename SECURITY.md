# Security

Please report a vulnerability privately, not in a public issue: use GitHub's "Report a vulnerability" on the repository's Security tab, or email the address on the maintainers' GitHub profile. Say what you found, how to reproduce it and what it affects. You will get an answer within a few working days.

What matters most in Zinko, and where it is enforced:

- **Another organization's data.** Every query is scoped to the signed-in organization and an id from another one is a 404, never a 403. A report you find reachable without its link, or an audit, finding or comparison of another organization, is a vulnerability.
- **The shared report link.** `/r/<token>` shows a frozen snapshot with no page paths or ad-platform IDs unless its author chose Detailed; it never prints check messages, capture errors or query strings. A page, hit or cookie value that reaches a report against that rule is a vulnerability.
- **Secrets.** Model keys are encrypted at rest and never returned; session and signing secrets are never logged. A way to read one is a vulnerability.
- **The capture engine** loads pages you point it at. It refuses private and local addresses unless `ALLOW_PRIVATE_NETWORKS=true`, which is for local fixture runs only. A way to make a deployed engine reach an internal address is a vulnerability.

Supported: the latest release and `main`.
