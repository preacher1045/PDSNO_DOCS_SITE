# Deployment guide

This guide covers deploying PDSNO in two configurations: the development setup for local testing, and the Docker Compose deployment for staging and production environments.

---

## Development deployment (single machine)

The development deployment runs all controllers as Python processes on a single machine using the in-process message bus. No Docker, no MQTT broker, no external database required.

### Prerequisites

```
Python 3.11+
Git
SQLite 3.35+ (ships with Python 3.11)
```

### Setup

```bash
git clone https://github.com/your-org/pdsno.git
cd pdsno

python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

pip install -r requirements.txt
python -m pdsno.data.init_nib --env dev
```

### Starting controllers

```bash
# Terminal 1 — Global Controller
python -m pdsno.controllers.global_controller \
  --config config/context_runtime.yaml \
  --role global --id global_cntl_1

# Terminal 2 — Regional Controller
python -m pdsno.controllers.regional_controller \
  --config config/context_runtime.yaml \
  --role regional --region zone-A \
  --parent global_cntl_1

# Terminal 3 — Local Controller
python -m pdsno.controllers.local_controller \
  --config config/context_runtime.yaml \
  --role local --region zone-A \
  --parent regional_cntl_zoneA_1 \
  --subnets 192.168.1.0/24
```

See [Quick start](../getting-started/quick-start.md) for expected output and verification steps.

---

## Docker Compose deployment

The Docker Compose deployment is the recommended path for staging and production environments. It runs seven services with proper networking, persistent storage, and monitoring.

### Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `postgres` | postgres:15 | 5432 | NIB persistent storage |
| `mosquitto` | eclipse-mosquitto:2 | 1883, 8883 | MQTT broker |
| `global-controller` | pdsno/controller | 8001, 9090 | Global Controller + metrics |
| `regional-controller` | pdsno/controller | 8002 | Regional Controller (zone-A) |
| `local-controller` | pdsno/controller | 8100 | Local Controller |
| `prometheus` | prom/prometheus | 9091 | Metrics collection |
| `grafana` | grafana/grafana | 3000 | Metrics dashboards |

### Prerequisites

```
Docker 24+
Docker Compose v2+
```

### Environment configuration

Copy the environment template and fill in your values:

```bash
cp .env.template .env
```

Required environment variables:

```bash
# .env

# Security — MUST be changed from defaults
PDSNO_BOOTSTRAP_SECRET=<generate with: openssl rand -hex 32>
PDSNO_MASTER_KEY=<generate with: openssl rand -hex 32>

# Database
DB_PASSWORD=<strong password>
POSTGRES_USER=pdsno
POSTGRES_DB=pdsno

# Network
PDSNO_REGION=zone-A
PDSNO_SUBNET=192.168.1.0/24
```

!!! danger "Never use default secrets in production"
    The development defaults for `PDSNO_BOOTSTRAP_SECRET` and `PDSNO_MASTER_KEY` are hardcoded in the repository. Any deployment using default values is insecure. Generate fresh values with `openssl rand -hex 32` before deploying.

### Starting the stack

```bash
# Build images
docker compose build

# Start all services
docker compose up -d

# Verify all services are healthy
docker compose ps

# View logs
docker compose logs -f global-controller
```

### Verifying the deployment

```bash
# Global Controller health check
curl http://localhost:8001/health

# Expected response
{
  "status": "healthy",
  "controller_id": "global_cntl_1",
  "timestamp": "..."
}

# Check NIB has been initialised
docker compose exec postgres psql -U pdsno -d pdsno \
  -c "SELECT COUNT(*) FROM controllers WHERE status='active';"

# Access Grafana dashboards
open http://localhost:3000
# Default credentials: admin / admin (change immediately)
```

---

## `context_runtime.yaml` reference

Each controller reads its runtime configuration from `config/context_runtime.yaml`. The file has sensible defaults for development — production deployments should override via environment variables.

```yaml
controller:
  id: auto_assigned           # Set by validation flow — do not set manually
  role: auto_determined       # Set by validation flow
  region: zone-A
  parent_id: null             # Set after validation

nib:
  backend: sqlite             # Use 'postgresql' for production
  path: ./config/pdsno.db    # SQLite path (ignored for PostgreSQL)
  wal_mode: true

communication:
  mode: in_process            # Phases 1–5: in_process | Phase 6: rest+mqtt
  rest_port: 8001             # Phase 6
  mqtt_broker: localhost:1883 # Phase 6

policy:
  discovery_interval: 300             # Seconds between discovery cycles
  missed_cycles_before_inactive: 3    # Cycles before device marked inactive
  lc_report_timeout: 600              # Seconds before RC requests on-demand discovery
  emergency_rate_limit_per_hour: 3    # Max emergency invocations per controller per hour

security:
  signing_key: null           # Set during validation — do not set manually
  cert: null                  # Set during validation
  freshness_window_seconds: 300
```

---

## Scaling guidelines

| Tier | Recommended instances | Notes |
|------|-----------------------|-------|
| Global Controller | 1 primary + 1 warm standby | Failover is manual in current implementation |
| Regional Controller | 1 per geographic zone | Scale zones, not instances within a zone |
| Local Controller | 1 per /24 subnet (guideline) | Add LCs if discovery cycle duration approaches interval |

**Local Controller sizing:** If a discovery cycle consistently takes more than 80% of the `discovery_interval`, add another LC and split the subnet. A single LC scanning a full /24 with ARP + ICMP + SNMP at the default 300-second interval completes comfortably on any modern host — this threshold is only relevant for unusually large subnets or very low discovery intervals.

---

## Network requirements

| Connection | Protocol | Port | Required |
|-----------|---------|------|---------|
| LC → RC | REST/HTTPS | 8443 | Yes (Phase 6) |
| RC → GC | REST/HTTPS | 8443 | Yes (Phase 6) |
| All → MQTT broker | MQTT over TLS | 8883 | Yes (Phase 6) |
| LC → Network devices | SNMP | 161/UDP | Yes |
| LC → Network devices | ICMP | — | Yes |
| External → GC NBI | REST/HTTPS | 443 | Optional |
| Prometheus → Controllers | HTTP | 9090 | Yes (monitoring) |

---

## Running the test suite

```bash
# All tests
pytest tests/ -v

# With coverage report
pytest tests/ -v --cov=pdsno --cov-report=term-missing

# Integration tests only (requires running NIB)
pytest tests/integration/ -v

# Discovery tests (requires network access or simulated subnet)
pytest tests/discovery/ -v --subnet 192.168.1.0/24
```

All 62 tests should pass. A clean run looks like:

```
62 passed in 8.50s
```

---

## Kubernetes deployment

Kubernetes manifests and a Helm chart are provided in `deployment/kubernetes/` and `deployment/helm/`. These are provided as a starting point — review and adapt them for your environment before using in production.

```bash
# Helm deployment
helm install pdsno ./deployment/helm \
  --set globalController.tls.enabled=true \
  --set postgresql.auth.password=<strong-password>

# Verify pods are running
kubectl get pods -n pdsno

# Check Global Controller health
kubectl port-forward svc/pdsno-global-service 8001:8001 -n pdsno
curl http://localhost:8001/health
```

---

## Common issues

**`INVALID_BOOTSTRAP_TOKEN` during validation**
The bootstrap secret on the requesting controller does not match the one on the Global Controller. Ensure both are using the same `PDSNO_BOOTSTRAP_SECRET` value.

**`CHALLENGE_TIMEOUT` during validation**
The requesting controller did not respond within 30 seconds. Check network connectivity between controllers and ensure system clocks are synchronised (NTP). The freshness window is 5 minutes — generous for any reasonable clock drift.

**`POLICY_VERSION_MISMATCH` on proposals**
The Local Controller submitted a proposal referencing an older policy version. This is normal during policy updates — the LC retries with the version included in the rejection response. If it persists, check that the LC's MQTT subscription to `pdsno/policy/{region}` is active.

**High NIB write conflict rate**
Multiple controllers are scanning the same subnet. Check that each LC has a distinct, non-overlapping subnet assignment in its scan policy.

**Grafana shows no data**
Prometheus is not scraping the controller metrics endpoints. Verify the controller is running on the expected port and that `9090/metrics` returns data. Check `prometheus.yml` target configuration.

**Bootstrap token already consumed**
A controller attempting to re-register with the same bootstrap token is rejected. Provision the controller with a fresh token using `scripts/generate_bootstrap_token.py`.

---

## Related pages

- [Quick start](../getting-started/quick-start.md) — minimal single-machine setup for development
- [Repository structure](repository-structure.md) — where configuration files and scripts live
- [Controller validation](../concepts/controller-validation.md) — understanding validation errors
- [Security model](../concepts/security-model.md) — production security checklist