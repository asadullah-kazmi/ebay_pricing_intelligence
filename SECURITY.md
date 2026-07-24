# Security policy

## Reporting a vulnerability

Do not open a public issue containing credentials, personal data, tenant identifiers, or vulnerability details.

Use GitHub's private vulnerability reporting for this repository when it is enabled. Until a dedicated security mailbox is configured, contact the repository owner privately through the account associated with the repository.

Include the affected commit, endpoint or component, reproduction conditions, impact, and any suggested mitigation. Do not access another organization's data, publish or change an eBay listing, or run load tests while investigating.

## Supported version

Security fixes are applied to the current `main` branch. Production should run a commit that has passed the required CI, CodeQL, migration, smoke, and tenant-isolation release gates.
