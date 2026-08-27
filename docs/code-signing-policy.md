# Code signing policy

## Current fork status

This Linear-backed fork **does not currently publish an official signed desktop release**.

Windows CI artifacts and local Windows builds are unsigned. macOS local builds are development builds and are not a substitute for Developer ID signing and Apple notarization.

The upstream project's signing sponsorship, certificates, maintainers, approval roles, or release process must **not** be presented as if they automatically apply to `ribo-project/linear-taskboard`.

## Distribution rule

Until a fork-specific signing process is established:

- treat GitHub Actions artifacts as development/test artifacts;
- do not describe them as trusted production installers;
- do not copy upstream SignPath approval or certificate claims into release notes for this fork;
- verify the exact source revision and workflow before using a CI-built installer;
- prefer local/internal validation while the Linear integration is still in desktop smoke-test stage.

## Future Windows signing

If this fork later publishes signed Windows releases, the process must be approved specifically for this repository and organization.

A future signing policy should define:

- the actual signing provider and certificate owner;
- repository-specific maintainers/reviewers/approvers;
- GitHub Actions workflow used to build the signing input;
- manual approval requirements;
- MFA/account requirements;
- incident response and certificate revocation procedure;
- release provenance and artifact retention.

No provider is claimed by this document until that process is actually configured for the fork.

## macOS

A public macOS build requires a fork-specific Apple Developer signing/notarization process. Development/ad-hoc builds are for local verification only.

## Privacy

Data handling and external network activity, including Linear API use, are documented in the [Privacy policy](../PRIVACY.md).

## Current release boundary

The current development target is to complete a real Codex Desktop smoke test of the Linear workflow before defining an official release channel:

```text
Linear Todo + codex-ready
→ Codex claim
→ In Progress
→ execution
→ Linear comment
→ In Review
```

Signing/distribution work should follow that functional validation rather than precede it.
