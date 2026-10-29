# Backend Contract Suite (`@mycms/core`)

> **ADR-0001 / ADR-0005:** Every backend implementation in MyCMS (`GithubBackend`, `FixtureBackend`, playground `FakeGithubServer`, and Stage-B providers like GitLab) must satisfy the exact same contract suite.

---

## 1. Overview of Checks

The `CORE_CONTRACT_SUITE` executes 8 ordered, self-contained checks verifying transactional CAS git-data semantics:

| # | Check Name | Description |
|---|---|---|
| 1 | `backend-shape/capabilities-and-methods` | Verifies exhaustive literal boolean capabilities and required methods. |
| 2 | `backend-reads/ref-and-tree` | Verifies `getRef` 40-hex SHA and recursive `readTree` without truncation. |
| 3 | `backend-reads/file-bytes` | Verifies `readFile` byte identity and size against tree entries. |
| 4 | `backend-reads/etag-not-modified` | Verifies conditional ETag revalidation returning 304 Not Modified. |
| 5 | `backend-reads/empty-tree-diff` | Verifies `listChangedFiles` reports zero diffs for identical commit SHAs. |
| 6 | `backend-reads/status-read-shape` | Verifies `readCheckRuns` and `readCommitStatuses` adhere to capability gates. |
| 7 | `backend-writes/single-commit-roundtrip` | Verifies single-commit write, exact diff set, and byte-exact read-back. |
| 8 | `backend-writes/stale-base-refusal` | Verifies fast-forward CAS refusal (`CAS_CONFLICT` 422) and HEAD immutability. |

---

## 2. Running Contract Tests

### In-Memory Exemplar (`FixtureBackend`)
```bash
pnpm --filter @mycms/core test -- src/backend/__tests__/contract-suite.test.ts --coverage.enabled=false
```

### GitHub Backend Replay (`GithubBackend` via Recorded HTTP Tape)
```bash
pnpm --filter @mycms/core test -- src/backends/github/__tests__/github-backend-replay.test.ts --coverage.enabled=false
```

### Full Project-Wide Test Suite (with Coverage Gate ≥90%)
```bash
pnpm -r test
```

---

## 3. Capturing Recorded HTTP Fixtures

Recorded tapes decouple unit tests from network dependencies and GitHub rate limits while guarding against transport drift.

Tapes are stored at:
`packages/core/src/backends/github/__tests__/fixtures/recorded-contract-tape.json`

### Synthetic / Offline Seed Generation
Generates a deterministic golden tape from `FakeGithubServer` with zero network access:
```bash
node scripts/capture-recorded-fixtures.mjs --seed
```

### Live GitHub Sandbox Capture Runbook
To record live traffic from a real GitHub repository:

1. **Prerequisites:**
   - A disposable GitHub sandbox repository (e.g. `your-org/mycms-sandbox`).
   - A fine-grained Personal Access Token (PAT) with:
     - `Contents: Read and write`
     - `Commit statuses: Read and write`
     - `Checks: Read and write`

2. **Execute Capture:**
   ```bash
   MYCMS_RECORD_OWNER=your-org \
   MYCMS_RECORD_REPO=mycms-sandbox \
   MYCMS_RECORD_BRANCH=contract-fixture \
   GITHUB_TOKEN=github_pat_... \
   node scripts/capture-recorded-fixtures.mjs
   ```

3. **Automated Security & Redaction Laws (Enforced by Script):**
   - **Secret Scrubbing (INV-A04 / INV-A05):** Authorization headers are scrubbed to `Bearer [token]`, and raw token occurrences are stripped.
   - **PII Scrubbing:** Git author and committer emails are masked to `cms-contract-bot@example.com`.
   - **Header Allowlist:** Tracking, infrastructure, and volatile headers (`x-github-request-id`, `set-cookie`, `date`) are dropped.
   - **Parameterization (INV-P14):** Repository paths are normalized to `test-owner` and `test-repo`.
   - **CAS Error Preservation:** 422 fast-forward rejection messages are preserved intact.
   - **Fail-Closed Gate:** The script scans the serialized tape and aborts with exit code 1 if any token pattern or secret is detected.

4. **Verify Tape Integrity:**
   ```bash
   pnpm fixtures:tape-check
   ```
