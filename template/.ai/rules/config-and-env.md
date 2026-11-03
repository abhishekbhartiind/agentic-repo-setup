# Rules: config and env

Applies to env examples, Docker, CI workflows and tool config files.

- **High-risk route.** Any change here uses the `high-risk` route in `.ai/workflow.md`.
- Never read, edit or print protected files (`policy.protected_paths` in `.ai/project.json`) or sensitive environment variables.
- A new or renamed variable is documented in the example env file and wherever config is validated, in the same change.
- Values that ship to clients (public or build-time variables) never hold secrets.
- Keep CI, Docker build args and example env files in sync.
