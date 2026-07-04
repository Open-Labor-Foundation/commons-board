# Security Policy

commons-board is an organizational governance platform that executes governed actions and holds sensitive operational data. Security is core to its design: every action is signed, hash-chained, and written to an immutable decision log before execution, and credentials are never stored in this repository.

## Credentials

No API keys, provider credentials, or connector secrets belong in this repository. Provider selection and configuration shape live in-repo; the secrets that back them are deployment-specific settings injected at runtime via environment or a secret store. Do not commit a usable secret under any circumstance.

## Reporting

For security concerns related to commons-board or the wider OLF platform, see the full policy in [open-labor-foundation](https://github.com/Open-Labor-Foundation/open-labor-foundation/blob/main/SECURITY.md).

Report vulnerabilities to **[security@openlabor.foundation](mailto:security@openlabor.foundation)**.
