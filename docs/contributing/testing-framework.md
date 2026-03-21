# Testing framework

PDSNO uses pytest with a structured test organisation. This page covers how tests are organised, what shared fixtures are available, how to run specific subsets, and the coverage targets for each module.

---

## Running tests

```bash
# Full suite — run this before every PR
pytest tests/ -v

# With coverage report
pytest tests/ -v --cov=pdsno --cov-report=term-missing

# Fast run — skip integration tests
pytest tests/ -v -m "not integration"

# Single module
pytest tests/test_discovery.py -v

# Single test
pytest tests/test_datastore.py::test_device_optimistic_locking -v

# Stop on first failure
pytest tests/ -x
```

---

## Test organisation

```
tests/
├── conftest.py                     Shared fixtures
├── test_base_classes.py            AlgorithmBase lifecycle, BaseController
├── test_controller_validation.py   Six-step validation flow, MessageBus routing
├── test_controller_nib_write.py    NIB persistence during validation
├── test_datastore.py               NIBStore CRUD, optimistic locking, Event Log, locks
├── test_discovery.py               ARP/ICMP/SNMP scanners, discovery cycle, RC handler
├── test_config_approval.py         Sensitivity classifier, approval workflow,
│                                   execution tokens, state machine, rollback, audit
└── test_message_auth.py            HMAC signing, verification, replay prevention, key manager
```

**Current totals:** 62 tests, 100% passing, ~8.5s execution time.

| Module | Tests | Coverage |
|--------|-------|----------|
| `base_class.py` | 7 | 95% |
| `sqlite_store.py` | 6 | 89% |
| `models.py` | — | 85% |
| `message_bus.py` | 4 | 82% |
| `message_format.py` | — | 88% |
| `global_controller.py` | 4 | 83% |
| `regional_controller.py` | 3 | 81% |
| `logger.py` | — | 96% |
| Discovery protocols | 12 | 95%+ |
| Config approval modules | 26 | 90%+ |
| `message_auth.py` | 20 | 92% |

**Modules needing coverage improvement:**

| Module | Coverage | Notes |
|--------|----------|-------|
| `main.py` | 0% | Entry point — needs integration tests |
| `config_loader.py` | 0% | Utility — add unit tests |
| `rest_api.py` | 58% | Partial — expand HTTP client tests |

---

## Shared fixtures

All fixtures are defined in `tests/conftest.py` and available in every test file without importing.

```python
@pytest.fixture
def nib_store(tmp_path):
    """In-memory NIBStore backed by a temporary SQLite file.
    Cleaned up automatically after each test."""
    db_path = tmp_path / "test_pdsno.db"
    store = NIBStore(str(db_path))
    yield store

@pytest.fixture
def context_manager(tmp_path):
    """ContextManager backed by a temporary YAML file."""
    context_path = tmp_path / "context.yaml"
    yield ContextManager(str(context_path))

@pytest.fixture
def message_bus():
    """Fresh MessageBus with no registered controllers."""
    yield MessageBus()

@pytest.fixture
def global_controller(nib_store, context_manager):
    """GlobalController wired to test NIB and context."""
    yield GlobalController(
        controller_id="global_cntl_1",
        context_manager=context_manager,
        nib_store=nib_store
    )

@pytest.fixture
def sample_device():
    """A valid Device object for use in NIB tests."""
    yield Device(
        device_id="nib-dev-001",
        ip_address="192.168.1.10",
        mac_address="aa:bb:cc:dd:ee:ff",
        status=DeviceStatus.ACTIVE,
        region="zone-A",
        managed_by_lc="local_cntl_zoneA_1",
        version=0
    )
```

Use these fixtures rather than creating your own database connections. Tests that create their own `sqlite3.connect()` calls are not following project conventions and will be rejected in review.

---

## Writing new tests

### Naming convention

```python
def test_{what_is_being_tested}_{condition_or_scenario}():
    ...

# Examples
def test_device_upsert_new_device():
def test_device_upsert_conflict_on_stale_version():
def test_challenge_response_rejected_after_timeout():
def test_sensitivity_classifier_bgp_pattern_returns_high():
```

### Structure — arrange, act, assert

```python
def test_device_optimistic_locking(nib_store, sample_device):
    # Arrange — write the device at version 0
    nib_store.upsert_device(sample_device)

    # Act — attempt write with stale version
    stale_device = Device(
        device_id="nib-dev-001",
        mac_address="aa:bb:cc:dd:ee:ff",
        ip_address="10.0.0.99",
        version=0      # Already been incremented — this is stale
    )
    result = nib_store.upsert_device(stale_device)

    # Assert
    assert not result.success
    assert result.conflict is True
```

### Test the failure paths

The most important tests are the ones that verify the system handles failures correctly. For every new feature, write at least one test for each failure mode:

- What happens when a required field is missing?
- What happens when the NIB write conflicts?
- What happens when the network call times out?
- What happens when validation fails at step N?

### Algorithm tests — use context injection

Because all algorithm inputs come through `initialize(context)`, algorithms can be tested without any live infrastructure:

```python
def test_arp_scanner_invalid_subnet():
    scanner = ARPScanner()

    with pytest.raises(ValueError, match="Invalid subnet format"):
        scanner.initialize({"subnet": "not-a-cidr"})

def test_arp_scanner_lifecycle():
    scanner = ARPScanner()
    scanner.initialize({"subnet": "192.168.1.0/24"})
    devices = scanner.execute()
    payload = scanner.finalize()

    assert payload["status"] == "complete"
    assert "devices_found" in payload
    assert isinstance(payload["devices"], list)
```

### Marking tests

```python
@pytest.mark.integration
def test_full_validation_flow_over_http():
    """Requires running GC REST server."""
    ...

@pytest.mark.slow
def test_discovery_full_subnet_scan():
    """Takes more than 5 seconds."""
    ...
```

Run integration tests explicitly:
```bash
pytest tests/ -v -m "integration"
```

---

## Test data guidelines

**Use fixtures, not globals.** Every test gets a fresh fixture instance — no shared state between tests.

**Use `tmp_path`** for any test that writes files or creates a database. `tmp_path` is a pytest built-in that provides a temporary directory cleaned up after each test.

**Use realistic but safe values** for IP addresses and MACs. The `192.168.1.0/24` range and `aa:bb:cc:*` MAC prefixes are conventional for test data. Do not use real production IP ranges.

**Do not mock the NIBStore** unless you are testing something completely unrelated to persistence. Testing against a real (temporary) SQLite database is fast and gives you much higher confidence than mocking.

---

## CI/CD

The test suite runs automatically on every pull request via GitHub Actions. The pipeline:

```yaml
# .github/workflows/test.yml (simplified)
- name: Run tests
  run: pytest tests/ -v --cov=pdsno

- name: Lint
  run: ruff check .

- name: Type check
  run: mypy pdsno/
```

A PR cannot be merged if any of these fail. Fix failures before requesting review — do not submit a PR with a known failing test and ask the reviewer to ignore it.

---

## Linting and formatting

```bash
# Check for linting errors
ruff check .

# Auto-fix fixable issues
ruff check . --fix

# Type checking
mypy pdsno/
```

PDSNO uses `ruff` for linting (faster than flake8, covers isort and more) and `mypy` for type checking. Both are in `requirements-dev.txt`.

---

## Related pages

- [How to contribute](how-to-contribute.md) — architecture rules and PR requirements
- [Repository structure](../reference/repository-structure.md) — where test files live and how modules map to tests