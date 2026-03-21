# Repository structure

This page maps the PDSNO repository layout — what lives where and why. Use this as a navigation reference when reading code or planning a contribution.

---

## Top-level layout

```
pdsno/
├── pdsno/                  Core Python package
├── tests/                  Test suite
├── examples/               Runnable simulation scripts
├── config/                 Configuration files and templates
├── deployment/             Docker, Kubernetes, Helm, systemd, Ansible
├── docs/                   In-repository documentation (design docs, specs)
├── docker/                 Docker Compose service configs
├── requirements.txt        Python dependencies
├── pytest.ini              Test configuration
└── mkdocs.yml              Documentation site configuration
```

---

## `pdsno/` — core package

```
pdsno/
├── __init__.py
├── __version__.py
├── main.py                     Entry point
│
├── controllers/                Controller implementations
│   ├── base_controller.py      BaseController — algorithm lifecycle, context management
│   ├── global_controller.py    GlobalController — validation, HIGH approvals
│   ├── regional_controller.py  RegionalController — LC validation, MEDIUM/LOW approvals
│   ├── local_controller.py     LocalController — discovery, execution
│   └── context_manager.py      Thread-safe YAML context store
│
├── core/                       Base abstractions
│   ├── base_class.py           AlgorithmBase — initialize/execute/finalize lifecycle
│   └── __init__.py
│
├── datastore/                  NIB storage layer
│   ├── sqlite_store.py         NIBStore — the only way controllers access the NIB
│   ├── models.py               Device, Config, Policy, Event, Lock, Controller, NIBResult
│   └── __init__.py
│
├── communication/              Inter-controller messaging
│   ├── message_format.py       MessageEnvelope, MessageType enum
│   ├── message_bus.py          In-process bus (Phases 1–5)
│   ├── rest_server.py          FastAPI server (Phase 6+)
│   ├── http_client.py          HTTP client with retry (Phase 6+)
│   ├── mqtt_client.py          MQTT pub/sub client (Phase 6+)
│   └── rest_api.py             REST client (Phase 6+)
│
├── discovery/                  Device discovery algorithms
│   ├── __init__.py
│   └── protocols/
│       ├── arp_scan.py         ARPScanner — AlgorithmBase subclass
│       ├── icmp_ping.py        ICMPScanner — AlgorithmBase subclass
│       └── snmp.py             SNMPScanner — AlgorithmBase subclass
│
├── config/                     Configuration approval logic (Phase 7)
│   ├── sensitivity_classifier.py   Pattern-based sensitivity classification
│   ├── approval_engine.py          ApprovalWorkflowEngine
│   ├── execution_token.py          ExecutionTokenManager
│   ├── config_state.py             ConfigStateMachine
│   ├── rollback_manager.py         RollbackManager
│   ├── audit_trail.py              AuditTrail
│   └── __init__.py
│
├── security/                   Security infrastructure
│   ├── message_auth.py         MessageAuthenticator, KeyManager (Phase 6C)
│   ├── key_distribution.py     DHKeyExchange, KeyDistributionProtocol (Phase 6D)
│   ├── auth.py                 Controller, API, Operator, Device authenticators
│   ├── rbac.py                 RBACManager — roles and permissions
│   ├── secret_manager.py       SecretManager — AES-256-GCM encrypted storage
│   ├── rate_limiter.py         RateLimiter — token bucket implementation
│   └── __init__.py
│
├── adapters/                   Vendor adapter layer (Phase 7)
│   ├── base_adapter.py         VendorAdapter, ConfigIntent, IntentType
│   ├── factory.py              VendorAdapterFactory
│   ├── cisco_ios_adapter.py    CiscoIOSAdapter
│   ├── juniper_adapter.py      JuniperAdapter
│   ├── arista_adapter.py       AristaAdapter
│   ├── netconf_adapter.py      NETCONFAdapter
│   └── __init__.py
│
├── devices/                    Device connection management
│   ├── connection_manager.py   ConnectionManager — session pooling
│   ├── session.py              DeviceSession
│   └── __init__.py
│
├── automation/                 Ansible integration
│   ├── ansible_runner.py       AnsiblePlaybookRunner
│   ├── playbook_validator.py   PlaybookValidator
│   ├── template_engine.py      TemplateEngine
│   └── core/                  Ansible playbooks, roles, templates, inventory
│
├── monitoring/                 Prometheus metrics
│   ├── metrics.py              Counter, Histogram definitions
│   └── __init__.py
│
├── logging/                    Structured logging
│   ├── logger.py               StructuredFormatter, get_logger, configure_logging
│   └── __init__.py
│
└── utils/                      Utilities
    ├── config_loader.py        YAML config loading with env overrides
    └── __init__.py
```

---

## `tests/`

```
tests/
├── conftest.py                 Shared fixtures — NIBStore, ContextManager, MessageBus
├── test_base_classes.py        AlgorithmBase lifecycle, BaseController
├── test_controller_validation.py  Full six-step validation flow, MessageBus
├── test_controller_nib_write.py   NIB writes during validation
├── test_datastore.py           NIBStore — device CRUD, optimistic locking, Event Log, locks
├── test_discovery.py           ARP/ICMP/SNMP scanners, LC discovery cycle, RC handler
├── test_config_approval.py     SensitivityClassifier, ApprovalWorkflow, ExecutionToken,
│                               ConfigStateMachine, RollbackManager, AuditTrail
└── test_message_auth.py        MessageAuthenticator, KeyManager, replay prevention
```

**62 tests, 100% passing.** Run with `pytest tests/ -v`.

Individual test modules can be run in isolation — useful during development:

```bash
pytest tests/test_discovery.py -v          # Discovery only
pytest tests/test_config_approval.py -v   # Config approval only
pytest tests/test_message_auth.py -v      # Security only
```

---

## `examples/`

Runnable simulation scripts — each demonstrates a complete end-to-end flow:

| Script | Demonstrates |
|--------|-------------|
| `simulate_validation.py` | Full six-step controller validation flow |
| `simulate_discovery.py` | Two discovery cycles with delta detection |
| `simulate_rest_communication.py` | GC + RC as separate processes over HTTP |
| `simulate_mqtt_pubsub.py` | Discovery reports over MQTT (requires Mosquitto) |
| `simulate_authenticated_communication.py` | HMAC signing, tamper detection, replay prevention |
| `simulate_key_distribution.py` | DH ephemeral key exchange between controllers |
| `simulate_config_approval.py` | LOW/MEDIUM/HIGH approval flows with rollback |

---

## `config/`

```
config/
├── context_runtime.yaml.template   Runtime config template — copy and customise
├── policy_default.yaml.template    Default policy values — copy and customise
├── scan_policy.yaml                Example scan policy with all fields annotated
├── logging.yaml                    Logging configuration for structured JSON output
└── environments/
    ├── dev.yaml                    Development overrides
    ├── staging.yaml                Staging overrides
    └── prod.yaml                   Production overrides
```

The `context_runtime.yaml` file is per-controller runtime configuration. Controllers read it at startup. It is not committed to the repository — each deployment creates its own from the template.

---

## `deployment/`

```
deployment/
├── docker/
│   ├── Dockerfile              Production image
│   └── docker-compose.yml      Full 7-service stack
├── kubernetes/
│   └── controller-deployment.yaml  K8s Deployment + Service
├── helm/
│   ├── chart.yaml
│   ├── values.yaml
│   └── templates/              GC deployment, RC deployment, service definitions
├── ansible/
│   └── playbook.yml            Bare-metal deployment automation
├── systemd/
│   └── pdsno-controller.service    Systemd unit file
└── install_scripts/
    ├── install_pdsno.sh
    ├── install_requirements.sh
    └── uninstall_pdsno.sh
```

---

## `docs/`

In-repository documentation — design documents, architecture specs, and sequence diagrams. This is distinct from the documentation website (which you are reading now). The in-repo docs serve developers working in the codebase; this site serves collaborators who need to understand the system.

```
docs/
├── PROJECT_OVERVIEW.md                  Authoritative project overview
├── architecture.md                      System architecture
├── ROADMAP_AND_TODO.md                  Master development roadmap and task tracker
├── OPERATIONAL_RUNBOOK.md               Day-2 operations reference
├── nib_spec.md                          NIB schema and consistency model
├── controller_hierarchy.md              Tier responsibilities and offline behaviour
├── dataflow.md                          End-to-end data flows
├── communication_model.md              Protocol assignment and message format
├── threat_model_and_mitigation.md      Threat scenarios T1–T10
├── api_reference.md                     Message types and NBI endpoints
├── deployment_guide.md                  Deployment instructions
├── use_cases.md                         Seven end-to-end scenario walkthroughs
├── algorithm_lifecycle.md               AlgorithmBase pattern reference
├── pdsno_gap_analysis.md               Vendor gap analysis and competitive positioning
├── research_paper_analysis.md          Analysis of 29 SDN research papers
└── architecture/
    ├── verification/                   Controller validation sequence and diagrams
    ├── approval_logic/                 Config approval logic and sequence diagrams
    ├── policy_propagation/             Policy propagation design and threat model
    └── device_discovery/               Device discovery sequence and diagrams
```

---

## Key files to know

| File | Why it matters |
|------|----------------|
| `pdsno/datastore/sqlite_store.py` | The entire NIB interface — all reads and writes go here |
| `pdsno/datastore/models.py` | Every NIB entity — Device, Config, Event, Lock, Controller, NIBResult |
| `pdsno/core/base_class.py` | AlgorithmBase — the pattern every algorithm module follows |
| `pdsno/controllers/global_controller.py` | The root of trust — six-step validation implementation |
| `pdsno/communication/message_format.py` | MessageEnvelope and MessageType — the contract for all messages |
| `docs/ROADMAP_AND_TODO.md` | The authoritative development plan — check here before starting any work |
| `config/context_runtime.yaml.template` | The annotated config reference |

---

## Related pages

- [Contributing](../contributing/how-to-contribute.md) — how to set up, branch, and submit work
- [Deployment guide](deployment-guide.md) — running the stack
- [Data models](data-models.md) — NIB schema reference
