# Quick start

This guide gets a minimal PDSNO environment running on a single machine — one Global Controller, one Regional Controller, one Local Controller. It is intended for development and exploration, not production deployment.

For production deployment with Docker Compose and full monitoring, see the [Deployment guide](../reference/deployment-guide.md).

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | Check with `python --version` |
| Git | Any recent | For cloning the repo |
| SQLite | 3.35+ | Ships with Python 3.11+ |

No Docker, no cloud infrastructure, no MQTT broker required for this quick start. The in-process message bus handles controller communication.

---

## 1. Clone and install

```bash
git clone https://github.com/your-org/pdsno.git
cd pdsno

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

---

## 2. Initialise the NIB

```bash
python -m pdsno.data.init_nib --env dev
```

This creates a SQLite database at `config/pdsno.db` with the full NIB schema — Device Table, Config Table, Policy Table, Event Log, and Controller Sync Table.

---

## 3. Start the controllers

Open three separate terminals, each with the virtual environment activated.

**Terminal 1 — Global Controller:**

```bash
python -m pdsno.controllers.global_controller \
  --config config/context_runtime.yaml \
  --role global \
  --id global_cntl_1
```

**Terminal 2 — Regional Controller:**

```bash
python -m pdsno.controllers.regional_controller \
  --config config/context_runtime.yaml \
  --role regional \
  --region zone-A \
  --parent global_cntl_1
```

**Terminal 3 — Local Controller:**

```bash
python -m pdsno.controllers.local_controller \
  --config config/context_runtime.yaml \
  --role local \
  --region zone-A \
  --parent regional_cntl_zoneA_1 \
  --subnets 192.168.1.0/24
```

When the Regional Controller starts, it will automatically request validation from the Global Controller. Watch Terminal 1 for the validation flow — you should see the challenge issued and the identity assigned within a few seconds.

---

## 4. Run the validation simulation

If you want to see the full validation flow in a single script without managing three terminals:

```bash
python examples/simulate_validation.py
```

Expected output:

```
[GC] Received VALIDATION_REQUEST from temp-rc-zone-a-001
[GC] Issued challenge challenge-xxxxxxxxxxxx
[RC] Received challenge, signing nonce...
[GC] Challenge verified successfully
[GC] Assigned identity: regional_cntl_zone-A_1
[RC] Validation successful — assigned ID: regional_cntl_zone-A_1
```

---

## 5. Run a discovery cycle

```bash
python examples/simulate_discovery.py
```

This runs a complete discovery cycle against a simulated subnet — ARP scan, ICMP ping, SNMP enrichment — writes discovered devices to the NIB, and sends a delta report to the Regional Controller.

Check the NIB to confirm devices were written:

```bash
sqlite3 config/pdsno.db "SELECT device_id, ip_address, status FROM devices LIMIT 10;"
```

---

## 6. Run the test suite

```bash
# All tests
pytest tests/ -v

# Just the core tests (fastest)
pytest tests/test_base_classes.py tests/test_datastore.py -v
```

All 62 tests should pass. If anything fails, check that your virtual environment is activated and dependencies are installed correctly.

---

## Configuration reference

The key configuration file is `config/context_runtime.yaml`. You can find a fully annotated template at `config/context_runtime.yaml.template`. The most important fields for local development:

```yaml
controller:
  id: auto_assigned
  role: auto_determined
  region: zone-A

nib:
  backend: sqlite
  path: ./config/pdsno.db

communication:
  mode: in_process        # Use REST+MQTT for Phase 6 deployments
```

---

## Common issues

**Challenge timeout during validation**
Usually a clock skew issue between terminals if running across machines. Ensure system time is correct. The freshness window is 5 minutes by default — generous for any local setup.

**NIB write conflicts during discovery**
Expected and handled. The optimistic locking retry logic catches concurrent writes. High conflict rates in local testing indicate multiple controllers scanning the same subnet — check your subnet assignments.

**Bootstrap token rejected**
The bootstrap secret is set in `global_controller.py` via the `PDSNO_BOOTSTRAP_SECRET` environment variable. For local development, the default value works. Never use the default in production.

**Port already in use (Phase 6 REST mode)**
```bash
lsof -ti:8001 | xargs kill -9
```

---

## Next steps

- Read [How it works](how-it-works.md) for the full architectural mental model
- Read [Controller validation](../concepts/controller-validation.md) for the six-step trust flow
- Read [Contributing](../contributing/how-to-contribute.md) to start building