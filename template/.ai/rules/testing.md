# Rules: testing

Applies to test files (`**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `tests/**`).

- Test behavior through public interfaces; assert outcomes, not implementation details.
- Every FRP acceptance criterion that code can check gets a test that fails without the change.
- Cover failure paths, not only the happy path.
- Mock at system boundaries (network, database, clock, external services), not inside the unit under test.
- Tests never read real env files or secrets; provide values through test setup.
- A passing run proves only what the tests exercise. Report everything in `agents.unverified` (`.ai/project.json`) as pending.
