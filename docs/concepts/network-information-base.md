# Network Information Base

The Network Information Base (NIB) is the single source of truth for all network and system state in PDSNO. It is not a passive database — it is the coordination point that makes distributed controller operation coherent.

Every piece of state that matters — device records, configuration approvals, policies, audit entries, coordination locks — is written to the NIB before any action is taken based on it. Controllers are stateless with respect to network knowledge. If a controller's memory disagrees with the NIB, the NIB wins.

---

## Why a shared state store

The core challenge in any distributed orchestration system is state consistency. If controllers maintain independent local state, they will inevitably diverge. A device one controller believes is online may be considered offline by another. A configuration one controller believes is approved may be unknown to the one responsible for executing it.

The NIB solves this by making one store authoritative. Rather than controllers communicating with each other to synchronise state, they all read from and write to the NIB through a defined interface. This eliminates an entire class of consistency bugs at the cost of a dependency on NIB availability — a tradeoff PDSNO accepts as worthwhile.

This design is independently aligned with **Onix** (Koponen et al., OSDI 2010) — the distributed SDN controller developed at Nicira that became the foundation for VMware NSX — which describes the NIB as "the heart of the control model."

---

## Scoped views

The NIB is not a single centralised server. Each controller tier maintains a **scoped NIB view**:

```
Local Controller     → NIB view covering its directly managed devices
Regional Controller  → NIB view covering its zone (aggregated from LCs)
Global Controller    → NIB view covering the full network (aggregated from RCs)
```

Writes flow **upward** — LCs write device discoveries, RCs aggregate and write regional views, the GC maintains the global view. Policies flow **downward** — GC writes policy, RCs receive and re-publish to their zone, LCs receive and apply locally.

---

## Six modules

| Module | Primary writer | What it stores |
|--------|---------------|----------------|
| **Device Table** | Local Controller | Every discovered device — IP, MAC, hostname, vendor, status |
| **Metadata Store** | Local Controller | Extended attributes — interfaces, uptime, SNMP data, capabilities |
| **Config Table** | All tiers | Every proposal, approval decision, execution record, rollback record |
| **Policy Table** | Global Controller | Active policies, version history, distribution records |
| **Event Log** | All tiers | Immutable audit trail — every decision, every change, every anomaly |
| **Controller Sync Table** | RC, GC | Coordination locks, execution tokens, sync state |

### Device Table

One record per discovered network device. MAC address is the canonical unique key — IP addresses change, MACs do not. The table tracks:

- `device_id` — NIB-assigned permanent identifier (e.g. `nib-dev-001`)
- `mac_address` — hardware address, unique constraint, used for deduplication across LCs
- `ip_address`, `hostname`, `vendor`, `device_type`
- `status` — `active` | `inactive` | `unreachable` | `quarantined`
- `first_seen`, `last_seen`, `discovery_method`
- `region`, `local_controller` — which LC manages this device
- `version` — integer counter for optimistic locking

### Config Table

Every configuration change leaves a complete record. The table tracks a change from proposal through execution or rollback:

- `proposal_id`, `config_hash` — identifies the specific change
- `category` — `LOW` | `MEDIUM` | `HIGH` | `EMERGENCY`
- `status` — the full state machine: `PENDING` → `APPROVED` → `EXECUTING` → `EXECUTED` | `FAILED` → `ROLLED_BACK` | `DEGRADED`
- `proposed_by`, `approved_by` — controller IDs, not human names
- `execution_token` — the single-use token issued on approval
- `rollback_payload` — stored at proposal time, not constructed after failure
- `policy_version` — the policy version in effect when the proposal was submitted

### Event Log

The most important module. Every significant action writes a signed entry here. The Event Log is:

- **Append-only** — a database trigger prevents UPDATE and DELETE operations
- **Signed** — each entry carries an HMAC-SHA256 signature of its content
- **Cross-validated** — entries are checked against NIB device state to detect falsification
- **Never deleted** — old entries may be archived to cold storage, never removed

Every entry records: `event_type`, `actor` (controller ID), `subject` (device or proposal ID), `action` (human-readable description), `decision`, `timestamp`, `signature`.

### Controller Sync Table

Manages coordination state during multi-step operations. The most critical use is **per-device configuration locks**: when a config approval is granted, a `CONFIG_LOCK` is acquired for each affected device. This lock is held until execution is confirmed, preventing concurrent conflicting changes from racing.

Locks are:
- Always time-bounded — they expire automatically if not released (default: 15 minutes)
- Acquired atomically — a race between two approvals is resolved by the lock, not by hoping
- Tied to a specific proposal — the approving controller holds the lock, not the requesting LC

---

## Two-tier data classification

Not all NIB data has the same consistency and durability requirements. PDSNO distinguishes two tiers:

| Tier | Examples | Consistency priority | Durability priority |
|------|---------|---------------------|-------------------|
| **Transient** | Device discovery results, link health, telemetry | Availability over consistency | Low — can be reconstructed |
| **Durable** | Controller identities, config approvals, policies, audit log | Consistency over availability | High — must survive failures |

In the current PoC, both tiers live in SQLite — the distinction is documented in the schema but not yet enforced at the storage layer. In Phase 6+, the NIB migrates to a two-tier backend:

- **Transient store** → Redis (high-availability, lower consistency, fast expiry)
- **Durable store** → PostgreSQL with replication (strong consistency, survives failures)

Because all controller code accesses the NIB exclusively through the `NIBStore` interface, this migration requires only reimplementing `NIBStore` — no controller logic changes.

This two-tier approach mirrors Onix's production architecture: DHT for transient state, Paxos-backed storage for durable state, adapted with more accessible modern technologies.

---

## Consistency model

### Current: optimistic locking

Every mutable NIB table has a `version` integer column. The write protocol is:

```
1. READ record + current version number
2. COMPUTE change locally
3. WRITE with condition: only commit if version == value read in step 1
4. CHECK result:
   - version matched → commit succeeded, increment version
   - version mismatch → CONFLICT — another writer got there first
5. ON CONFLICT: re-read, re-compute, retry (up to max_retries = 3)
```

Optimistic locking adds zero overhead on the fast path (no conflict) and only pays a cost when conflicts actually occur. At low contention — the normal case — it is strictly better than pessimistic locking (which serialises all writes through a lock manager regardless of whether conflict is likely).

What optimistic locking prevents: **lost updates** — two writers clobbering each other.

What optimistic locking does not prevent: **read skew** — reading two related records at different points in time and seeing an inconsistent snapshot. For PDSNO's PoC use cases this is acceptable; the NIB is not a financial ledger.

### Conflict resolution rules

| Data type | Conflict rule | Rationale |
|-----------|--------------|-----------|
| Config approval | First writer wins; second gets CONFLICT | Preventing duplicate approvals is worth the retry cost |
| Device discovery | Most recent `last_seen` timestamp wins | Fresher data is more accurate |
| Policy writes | Serialised through GC — RC never writes policy directly | No conflicts possible by design |
| Event Log | Append-only with UUID keys | No conflicts possible |
| Controller sync locks | Compare-and-swap at DB level | Atomic |

### Target: adaptive consistency (Phase 6+)

Research into distributed SDN architectures identifies a critical limitation of both static eventual consistency and static strong consistency: neither is optimal across all operation types. The target for Phase 6+ is an adaptive model that routes writes based on data type:

| Operation | Consistency level |
|-----------|-----------------|
| Device discovery, link health | Eventual — speed matters, brief staleness acceptable |
| Config proposals and approvals | Strong — a wrong decision can damage the network |
| Controller identity | Strong — must be consistent before the controller acts |
| Policy distribution | Strong — all controllers must see the same version |
| Audit log | Strong (append-only) — no staleness in the compliance record |
| Lock acquisition | Strong — races here are dangerous |

The `data_tier` field on every NIB entity drives this routing. No controller code changes — only `NIBStore` is re-implemented.

---

## The NIBStore interface

All controller code accesses the NIB exclusively through `NIBStore`. No controller imports or instantiates a storage backend directly. This is enforced by convention and checked in code review.

```python
# Wrong — direct database access
conn = sqlite3.connect('pdsno.db')

# Right — through the interface
result = nib.upsert_device(device)
if not result.success:
    raise SomeAppropriateError(result.error)
```

Every `NIBStore` method that modifies state returns a `NIBResult`. Callers must check it. Assuming success without checking is a contributor error.

Key interface methods:

```python
# Device Table
nib.get_device(device_id)
nib.get_device_by_mac(mac_address)
nib.upsert_device(device)          # Returns NIBResult
nib.update_device_status(device_id, status, version)

# Config Table
nib.create_config_proposal(proposal)
nib.update_config_status(config_id, status, approver, version)
nib.get_active_config(device_id)

# Event Log
nib.write_event(event)             # Always succeeds or raises

# Locks
nib.acquire_lock(subject_id, lock_type, held_by, ttl_seconds)
nib.release_lock(lock_id, held_by)
nib.check_lock(subject_id, lock_type)

# Policy
nib.get_active_policy(scope, region)
nib.distribute_policy(policy)
```

---

## Write protocol

Every write follows this sequence:

```
1. READ current record + version number
2. APPLY changes to local copy
3. WRITE with version check
   → version matches: commit, increment version
   → version mismatch: return CONFLICT
4. CHECK NIBResult
   → SUCCESS: proceed
   → CONFLICT: re-read, re-apply, retry (max 3 attempts)
   → FAILURE: log error, escalate
```

Never skip the version check. Never assume a write succeeded without checking `NIBResult`.

---

## Retention policy

| Table | Retention |
|-------|-----------|
| Device Table | Devices unseen for 90 days → `inactive`. After 365 days inactive → may be deleted |
| Config Table | Records retained 180 days after execution |
| Policy Table | Superseded policies retained 30 days for audit |
| Event Log | **Never deleted.** Old entries archived to cold storage after 365 days |
| Controller Sync Table | Expired locks cleaned up every 60 seconds by background job |

---

## Related pages

- [Device discovery](device-discovery.md) — how device records get into the Device Table
- [Config approval](config-approval.md) — how the Config Table and Controller Sync Table are used together
- [Communication model](communication-model.md) — how NIB updates propagate between controller tiers
- [Data models](../reference/data-models.md) — full schema reference