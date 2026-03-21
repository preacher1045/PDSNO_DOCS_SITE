# Controller hierarchy

The three-tier controller hierarchy is PDSNO's central architectural pattern. This page covers how the tiers relate, what each one owns, how controllers behave when connectivity is degraded, and how the hierarchy scales.

---

## The three tiers

```
global_cntl_1 (primary)    global_cntl_2 (standby)
       │                           │
       └─────────── East/West ─────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
  regional_cntl_1  regional_cntl_2  ...   (1 per zone)
          │
     ┌────┼────┐
     ▼    ▼    ▼
  lc_1  lc_2  lc_3  ...                  (1–N per region)
```

| Tier | Count | Scope | Validates |
|------|-------|-------|-----------|
| **Global** | 1 primary + 1 standby | Entire network | Regional Controllers |
| **Regional** | 1 per geographic zone | Single zone | Local Controllers (delegated) |
| **Local** | 1 per subnet block | Direct device reach | Nothing |

---

## Why this structure exists

The hierarchy is not about performance — a flat peer-to-peer architecture would be faster. It exists because governance requires a defined chain of authority.

Three properties that only a hierarchy provides:

**A single root of trust.** Every controller's identity traces back to the Global Controller. There is no ambiguity about who issued a certificate or whether a controller is legitimate. In a flat architecture, there is no root — identity is more complex to anchor.

**A defined policy winner.** When two controllers have conflicting policy views (which happens during propagation delays), the hierarchy determines which one wins: the higher tier. There is no vote, no consensus algorithm at this layer — the GC's policy is authoritative.

**A clear escalation path for high-risk changes.** HIGH-sensitivity configuration changes must travel to the GC for approval. This is only coherent in a hierarchical model. In a flat architecture, every peer would have equal authority, which means no change would be meaningfully more scrutinised than another.

---

## Responsibilities matrix

| Responsibility | LC | RC | GC |
|---|---|---|---|
| Device discovery (execution) | ✓ | | |
| Discovery report aggregation | | ✓ | |
| Global device inventory | | | ✓ |
| LOW config approval | ✓ (direct) | ✓ (auto) | |
| MEDIUM config approval | | ✓ | |
| HIGH config approval | | | ✓ |
| Emergency execution | ✓ | | |
| LC validation (delegated) | | ✓ | |
| RC validation | | | ✓ |
| Global policy authority | | | ✓ |
| Regional policy enforcement | | ✓ | |
| Anomaly detection (local) | ✓ | | |
| Anomaly detection (regional) | | ✓ | |
| Anomaly detection (global) | | | ✓ |
| Audit log writes | ✓ | ✓ | ✓ |

---

## Controller discovery and peering

Controllers do not discover each other via network broadcast. Connections are configured explicitly:

- Local Controllers know their parent RC's address from `context_runtime.yaml`
- Regional Controllers know their parent GC's address from `context_runtime.yaml`
- A controller that cannot reach its parent on startup enters `PENDING_VALIDATION` state and retries with exponential backoff

This is deliberate. Auto-discovery of controllers would open an attack surface — a malicious process could advertise itself as a controller and participate in the hierarchy. Explicit configuration means a rogue process cannot join without being provisioned.

---

## Offline behaviour

Knowing what happens when connectivity is lost is essential for understanding PDSNO's fault tolerance properties.

### Local Controller goes offline

- RC detects missing discovery reports after `policy.lc_report_timeout`
- RC writes `LC_DISCOVERY_OVERDUE` event, sends on-demand discovery request
- If LC remains offline: its managed devices accumulate missed cycles and are eventually marked inactive per normal discovery rules
- Config proposals targeting the LC's devices are blocked until the LC is back online and has re-reported

### Regional Controller goes offline

- LCs queue proposals locally and retry with exponential backoff
- LOW changes can execute directly if policy allows (`allow_local_exec: true`)
- HIGH changes are blocked — there is no path to the GC without the RC
- On RC reconnect: RC requests full resync from GC for the period it was absent

### Global Controller goes offline

- RCs and LCs continue operating for LOW/MEDIUM changes — RC has approval authority for these
- HIGH changes are blocked — GC is the only HIGH approval authority
- `global_cntl_2` standby is warm but failover is manual in the current implementation
- When GC comes back online: normal operation resumes; no changes were lost (they were queued or blocked)

!!! warning "GC failover is not yet automated"
    The warm standby (`global_cntl_2`) requires manual intervention to promote in the current implementation. Automated GC failover with safe trust transfer is a known open design question, tracked for Phase 6+. Do not design systems that assume automatic GC failover.

---

## Controller naming convention

Controller names are **assigned by the validating controller** during the validation flow. Controllers do not self-name.

| Pattern | Example | Notes |
|---------|---------|-------|
| `global_cntl_{sequence}` | `global_cntl_1` | Sequence from 1; primary is always `_1` |
| `regional_cntl_{region}_{sequence}` | `regional_cntl_zoneA_2` | Region slug + sequence |
| `local_cntl_{region}_{sequence}` | `local_cntl_zoneA_5` | Same region slug as parent RC |

The region slug in the name must match the region the controller actually serves. The validating controller enforces this — an LC claiming `zone-B` in a request to a `zone-A` RC is rejected at Step 5 of the validation flow.

---

## Scaling guidelines

**Local Controllers:** One LC per `/24` subnet is the baseline guideline for the PoC. This is not a hard limit — it is based on scan timing. A single LC scanning a full `/24` with ARP + ICMP + SNMP at 300-second intervals completes comfortably within the interval on any reasonable host. If your discovery cycle duration approaches your discovery interval, add another LC and split the subnet.

**Regional Controllers:** One per geographic zone. Scale zones, not instances within a zone. A single well-resourced RC handles all LCs in a zone comfortably. Horizontal scaling of RCs within a zone is not supported in the current architecture.

**Global Controllers:** One primary, one warm standby. The GC's load is low — it handles RC validation (infrequent), HIGH-sensitivity approvals (infrequent), and policy distribution (infrequent). It is not in the hot path for most operations.

---

## Internal controller structure

Every controller — regardless of tier — has the same four internal components. The tier determines *what* decisions are made, not *how* the controller is structured.

```
┌──────────────────────────────────┐
│         DECISION ENGINE          │
│   approval logic, policy checks  │
├──────────────────────────────────┤
│      COMMUNICATION LAYER         │
│   REST server + MQTT client      │
├──────────────────────────────────┤
│          DATA LAYER              │
│   NIBStore — all reads/writes    │
├──────────────────────────────────┤
│       ALGORITHM MODULES          │
│   discovery, validation,         │
│   optimisation — all follow      │
│   initialize/execute/finalize    │
└──────────────────────────────────┘
```

The algorithm lifecycle pattern (`initialize` → `execute` → `finalize`) is enforced on every operational module. This makes algorithms independently testable — all inputs come in through `initialize(context)`, so any algorithm can be unit-tested by passing a carefully constructed context dict without needing live network infrastructure.

---

## Related pages

- [Controller validation](controller-validation.md) — how a controller earns its place in the hierarchy
- [Communication model](communication-model.md) — how controllers talk to each other
- [Config approval](config-approval.md) — how the hierarchy governs configuration changes
- [Security model](security-model.md) — trust boundaries and cryptographic assumptions