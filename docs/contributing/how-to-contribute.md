# How to contribute

PDSNO is an active open-source project welcoming contributors at all experience levels. This page covers everything you need to go from zero to a merged pull request — environment setup, coding standards, the architecture review process, and what makes a good contribution.

Read this page before writing any code. The most common reason contributions are rejected is not code quality — it is misalignment with the architecture.

---

## Before you start

Read these three documents before writing any code:

1. [What is PDSNO](../getting-started/what-is-pdsno.md) — the problem it solves and what it is not
2. [How it works](../getting-started/how-it-works.md) — the architecture you are working within
3. [Design decisions](../design-decisions/index.md) — why things are the way they are

If anything is unclear after reading these, open a GitHub issue tagged `question` before building something that may need to be rearchitected. Questions are welcome. Rework is expensive.

---

## Environment setup

```bash
# Clone the repository
git clone https://github.com/your-org/pdsno.git
cd pdsno

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Install runtime and development dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt    # test + lint tools

# Initialise the development NIB
python -m pdsno.data.init_nib --env dev

# Confirm everything works
pytest tests/ -v
```

All 62 tests should pass on a clean install. If anything fails, stop and fix it before proceeding — a broken baseline makes it impossible to know whether your changes introduced a regression.

---

## Branching and pull requests

```
main             → stable, tagged releases only
dev              → integration branch — all feature branches merge here
feature/<name>   → your work
fix/<issue>      → bug fixes referencing a specific issue number
```

**Branch from `dev`, not from `main`.** Pull requests targeting `main` will be redirected.

**PR requirements — all must be satisfied before review:**

- [ ] All existing tests pass (`pytest tests/ -v`)
- [ ] New tests written for new behaviour — no untested code paths
- [ ] No new linting errors (`ruff check .`)
- [ ] If you changed architecture: relevant docs in `docs/` are updated
- [ ] PR description explains *why*, not just *what*

---

## Architecture review rules

These are the rules that apply to any contribution touching system design. Check them before submitting. A PR that violates them will be returned for revision regardless of code quality.

**Rule 1 — Never bypass the NIB.**
No controller module may import or instantiate a storage backend directly. All NIB access goes through `NIBStore`. If you find yourself writing `sqlite3.connect(...)` in a controller, stop — that is wrong.

```python
# Wrong
conn = sqlite3.connect('pdsno.db')
cursor = conn.execute("SELECT * FROM devices")

# Right
device = nib.get_device_by_mac(mac_address)
```

**Rule 2 — Always check NIBResult.**
Every `NIBStore` method that modifies state returns a `NIBResult`. You must check it. Do not assume success.

```python
# Wrong
nib.upsert_device(device)

# Right
result = nib.upsert_device(device)
if not result.success:
    if result.conflict:
        # re-read and retry
    else:
        raise SomeAppropriateError(result.error)
```

**Rule 3 — Write the audit event.**
Every significant state change must write a corresponding event to the Event Log. No state change is silent.

```python
result = nib.upsert_device(device)
if result.success:
    nib.write_event(Event(
        event_type="DEVICE_DISCOVERED",
        controller_id=self.controller_id,
        ...
    ))
```

**Rule 4 — Follow the algorithm lifecycle.**
All algorithm modules follow `initialize(context)` → `execute()` → `finalize()`. Do not add parameters to `execute()`. All inputs enter through `initialize(context)`.

```python
# Wrong
algorithm.execute(subnet="192.168.1.0/24")

# Right
algorithm.initialize({"subnet": "192.168.1.0/24"})
result = algorithm.execute()
payload = algorithm.finalize()
```

**Rule 5 — New message types go in the API reference first.**
If your contribution introduces a new inter-controller message type, add it to `docs/api_reference.md` before implementing it. The message type is the contract between components — define it before writing code that depends on it.

**Rule 6 — No direct tier-skipping.**
A Local Controller communicates with its Regional Controller. A Regional Controller communicates with its Global Controller. LCs do not communicate with the GC directly. Controllers do not reach into another tier's NIB.

---

## Coding standards

**Python version:** 3.11+. Use type hints on all function signatures.

```python
# Correct
def get_device(self, device_id: str) -> Optional[Device]:
    ...

# Wrong — missing type hints
def get_device(self, device_id):
    ...
```

**Logging** — use `get_logger` from `pdsno.logging.logger`, not the root `logging` module directly. Include `controller_id` so every log entry is traceable.

```python
from pdsno.logging.logger import get_logger
self.logger = get_logger(__name__, controller_id=self.controller_id)
self.logger.info("Device discovered", extra={'extra_fields': {'mac': device.mac_address}})
```

**No bare `print()` statements** in production code. Use the structured logger.

**No hardcoded secrets or IPs.** Configuration values come from `context_runtime.yaml` via `ContextManager` or from environment variables.

**Algorithm instances are single-use.** Create a fresh instance for each execution. Do not reset and reuse.

```python
# Wrong — reusing instance
scanner = ARPScanner()
for subnet in subnets:
    scanner.initialize({"subnet": subnet})    # State from previous run may leak
    scanner.execute()

# Right — fresh instance per run
for subnet in subnets:
    scanner = ARPScanner()
    scanner.initialize({"subnet": subnet})
    scanner.execute()
    scanner.finalize()
```

---

## Writing tests

Every new behaviour needs a test. Every bug fix needs a test that would have caught the bug. No untested code paths.

**Test file naming:** `tests/test_{module_name}.py`

**Use the shared fixtures** from `tests/conftest.py` — `NIBStore`, `ContextManager`, and `MessageBus` are available as pytest fixtures. Do not create your own database connections in tests.

**Test the failure paths, not just the happy path.** The most important tests in PDSNO are the ones that verify the system behaves correctly when something goes wrong — NIB write conflict, challenge timeout, rollback failure.

```python
def test_device_write_conflict(nib_store):
    """Two concurrent writers — second should get CONFLICT"""
    device = Device(mac_address="aa:bb:cc:dd:ee:ff", ip_address="10.0.0.1", ...)
    nib_store.upsert_device(device)

    # Simulate second writer reading at version 0
    stale_device = Device(mac_address="aa:bb:cc:dd:ee:ff", ip_address="10.0.0.2", version=0, ...)
    result = nib_store.upsert_device(stale_device)

    assert not result.success
    assert result.conflict is True
```

**Integration tests** (`tests/integration/`) require a running NIB and in-process message bus. Mark them with `@pytest.mark.integration` so they can be excluded from fast runs.

---

## Documentation standards

If you change behaviour, update the documentation. The docs and the code must stay in sync.

**Where documentation lives:**

- Architecture changes → `docs/` in the project repo (design specs, pseudocode)
- New message type → `docs/api_reference.md`
- New NIB table or field → `docs/nib_spec.md` + a migration script
- New use case → `docs/use_cases.md`
- Significant decision → `docs/design-decisions/` section of this documentation site

**Writing style for in-repo docs:** prose with code blocks for pseudocode and schemas. Avoid bullet-point walls — a sentence explains reasoning better than a list item. Write for a contributor who will read this six months from now and needs to understand *why*, not just *what*.

---

## What makes a good first contribution

The best first contributions are in one of these categories:

**Test coverage gaps** — `pdsno/main.py`, `pdsno/communication/rest_api.py`, and several utility modules have low test coverage. Adding tests for untested paths is valuable, low-risk, and a good way to learn the codebase.

**Documentation gaps** — if you read a doc page and found it unclear, incomplete, or incorrect, fix it. Documentation PRs are reviewed quickly and merged readily.

**Discovery protocol improvements** — the SNMP and ICMP scanner implementations use simulated responses in the PoC. Replacing the simulation with real `pysnmp` or `ping3` implementations is a well-scoped, impactful contribution.

**Vendor adapter stubs** — the adapter layer (`pdsno/adapters/`) has Cisco, Juniper, Arista, and NETCONF adapters with partial implementations. Improving the translation coverage for a specific vendor is a concrete, testable contribution.

---

## Getting help

**GitHub Issues** — for bugs, questions, and feature proposals. Tag with `bug`, `question`, or `enhancement` as appropriate.

**Architecture questions** — tag with `architecture-review`. These are reviewed before any related implementation begins. Do not implement first and ask second.

**Security issues** — do not open a public issue. Email the maintainers directly (see `SECURITY.md` in the repository).

---

## Related pages

- [Testing framework](testing-framework.md) — test organisation, fixtures, and running specific test suites
- [Repository structure](../reference/repository-structure.md) — where everything lives
- [Design decisions](../design-decisions/index.md) — why the architecture is the way it is
- [System goals](../getting-started/system-goals.md) — the principles that govern all design decisions