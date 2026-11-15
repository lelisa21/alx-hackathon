# T9 — Code Modularization and Technical Debt (phase-T9-prompt)

**Priority**: P2 (post-launch, lower priority than P1 gates).

**Scope**: Document code organization improvements and technical debt for post-event maintenance. This is not a blocker for demo or judges' trial; it is future housekeeping.

---

## Status

**NOT REQUIRED FOR DEMO** — All T0–T8 work is complete and verified. T9 is a backlog task for after the event.

---

## Identified Modularization Opportunities

### 1. Extract shared test fixtures into reusable modules

**Current state:**
- Test fixtures duplicated across packages (e.g., mock sessions, mock providers, mock content sources)
- Fixture setup code repeated in `packages/*/tests` directories

**Opportunity:**
- Create `packages/test-fixtures` with shared builders and mock factories
- Reduce fixture setup boilerplate in unit tests
- Maintain a single source of truth for test data contracts

**Effort:** ~4 hours
**Risk:** Low (non-production code; requires careful import scoping to avoid circular deps)

---

### 2. Consolidate TypeScript/ESLint/Prettier configuration

**Current state:**
- Root `tsconfig.json`, `eslint.config.mjs`, `stylelint.config.mjs`
- Package-specific `tsconfig.json` files inherit from root
- Lint rules duplicated across workspace

**Opportunity:**
- Centralize config inheritance rules
- Document override policies per package
- Create a `packages/config` or `.kiro/config` module to eliminate duplication

**Effort:** ~2 hours
**Risk:** Low (non-production; improves CI clarity)

---

### 3. Separate API-layer HTTP concerns from domain logic

**Current state:**
- API routes in `packages/api/src/routes/` depend on domain types from `packages/engine/`
- Adapter composition happens at API startup; unclear dependency flow
- OpenAPI generation intermingled with request validation

**Opportunity:**
- Create `packages/http-contracts` with versioned OpenAPI/Zod schemas (live source of truth)
- Move HTTP validation and serialization concerns into a separate layer
- Keep domain types domain-only; adapters implement conversion
- Result: domain logic is protocol-agnostic (matches AR-02)

**Effort:** ~8 hours
**Risk:** Medium (requires careful testing to ensure contracts remain stable)

---

### 4. Extract provider-registry and capability-filtering logic

**Current state:**
- Provider registry in `packages/ai/src/registry.ts`
- Capability filtering spread across ask pipeline and engine code
- Provider selection heuristics replicated in multiple places

**Opportunity:**
- Create `packages/provider-registry` as an explicit module (if `ai` grows large)
- Document capability filtering rules in one place
- Unit test provider selection logic in isolation
- Make it easier to audit provider precedence and fallbacks

**Effort:** ~3 hours
**Risk:** Low (existing code already modular; mainly extraction and documentation)

---

### 5. Consolidate database migration utilities

**Current state:**
- Migrations in `packages/api/src/db/migrations/` 
- Migration runner logic mixed with API startup
- No shared migration schema versioning across potential future packages

**Opportunity:**
- Extract `packages/db-migrations` or `packages/db-schema` 
- Move migration runner to a shared utility
- Document migration contracts (idempotency, rollback semantics)
- Enables other packages (e.g., jobs, insights) to own schema slices

**Effort:** ~4 hours
**Risk:** Low (migrations are already isolated; mainly organizational)

---

### 6. Isolate package-specific CLI commands

**Current state:**
- Scripts in `package.json` at root and per-package
- CLI commands like `pnpm migrate`, `pnpm eval`, `pnpm lang:check` call shell scripts
- Script logic scattered across `scripts/`, `packages/*/scripts`, and inline commands

**Opportunity:**
- Create `packages/cli` with a unified command dispatcher
- Move `migrate`, `eval`, `lang:check`, `content:ingest`, `usage`, etc. into structured commands
- Document each command's inputs, outputs, and error cases
- Make it easier to extend with new maintainer commands

**Effort:** ~6 hours
**Risk:** Medium (CLI is external surface; requires backward-compatibility shim)

---

### 7. Extract e2e test helpers and page objects

**Current state:**
- Playwright e2e tests in `tests/e2e/` and pre-existing failures in widget tests
- Duplicated selectors and page navigation logic
- Page objects not abstracted; tests tightly coupled to DOM

**Opportunity:**
- Create Playwright page objects for tutor, helper console, teacher insights
- Extract common e2e helpers (login, ask, wait for response, etc.)
- Document known pre-existing failures (from T6 report)
- Enable future e2e work without fixing DOM selectors from scratch

**Effort:** ~4 hours
**Risk:** Medium (requires co-designer sign-off on page object semantics; e2e already has pre-existing failures)

---

### 8. Document and enforce architecture boundaries

**Current state:**
- Architecture rules in blueprint section 2 (AR-02, D01–D28)
- No automated enforcement of package-boundary rules
- Dependency direction can drift over time

**Opportunity:**
- Add ESLint rules or a custom checker to enforce:
  - `engine` never imports from `api` 
  - `api` never imports from `widget`
  - Adapters live behind ports, not in domain
- Document which imports are allowed/forbidden per package
- CI checks dependency graph health

**Effort:** ~3 hours
**Risk:** Low (documentation + testing; no runtime impact)

---

## Non-Issues (Intentional Design)

### Why we're not refactoring these:

- **Monorepo vs. polyrepo:** Current structure supports gradual migration to separate deployments. No change needed.
- **Provider adapters duplication:** Each provider has different auth/contract needs. Shared code would harm clarity.
- **Locale pack format:** Current YAML structure is simple and extensible. No refactoring needed unless adding new content types.
- **Widget component tree:** Lit components are intentionally granular per W3C custom-element best practices. Consolidating components would hurt reusability.

---

## Implementation Priority (if time permits post-event)

1. **High impact, low effort:**
   - Extract shared test fixtures (#1) — unlocks faster test writing
   - Consolidate config (#2) — improves CI transparency

2. **Medium impact, medium effort:**
   - API-layer refactoring (#3) — supports future adapter work (e.g., gRPC, WASM)
   - Database migration utilities (#5) — enables feature teams to own schema
   - CLI command dispatch (#6) — maintainability for ops

3. **Lower priority:**
   - Provider registry extraction (#4) — already well-isolated
   - E2E helpers (#7) — pre-existing test failures mask value
   - Architecture enforcement (#8) — useful but not blocking demo

---

## Acceptance Criteria (if this work is scheduled)

- [ ] No new dependencies added; modularization uses only existing package ecosystem
- [ ] All existing tests continue to pass
- [ ] No performance degradation (measure import resolution time if relevant)
- [ ] Documentation updated with new module responsibilities and boundaries
- [ ] No breaking changes to public API or CLI contracts (backward compatibility shim if needed)
- [ ] PR follows AGENTS.md code review rules and quotes requirement IDs

---

## References

- Dimts-System-Blueprint-v2.0.md, section 2 (Architecture), AR-02, D01–D28
- AGENTS.md (this workspace)
- DECISIONS.md (D28: portability boundary)

---

## Notes

**This task is P2 (post-launch).** Focus remains on T0–T8 completion and the event-day gates. Code modularization improves long-term maintainability but is not required for demo acceptance. Document this plan for future sprints.

