# Data models

This page is the schema reference for the Network Information Base. It covers the full table definitions, field types, constraints, and the entity hierarchy that all NIB objects inherit from.

For the conceptual model — why the NIB exists, how it is accessed, and its consistency guarantees — see [Network Information Base](../concepts/network-information-base.md).

---

## Entity base class

Every object stored in the NIB inherits from `NetworkEntity`. This provides consistent identity, versioning, and data-tier classification across all entity types.

```python
@dataclass
class NetworkEntity:
    entity_id: str          # UUID — NIB-assigned permanent identifier
    version: int            # Optimistic locking counter — incremented on every write
    created_at: datetime    # UTC timestamp of first write
    updated_at: datetime    # UTC timestamp of last successful write
    data_tier: str          # "transient" | "durable" — routes to correct storage backend
```

The `data_tier` field determines how the entity is stored in Phase 6+ (Redis for transient, PostgreSQL for durable). In the PoC, all entities live in SQLite — the field is stored but not yet used for routing.

**When in doubt, classify as durable.** The cost of incorrect transient classification (stale reads causing wrong decisions) is higher than the cost of over-classifying as durable (slightly slower writes).

---

## Device Table

Stores one record per discovered network device. Updated by Local Controllers during discovery cycles.

```sql
CREATE TABLE devices (
    device_id          TEXT        PRIMARY KEY,
    temp_scan_id       TEXT,
    ip_address         TEXT        NOT NULL,
    mac_address        TEXT        UNIQUE NOT NULL,
    hostname           TEXT,
    vendor             TEXT,
    device_type        TEXT,
    status             TEXT        NOT NULL DEFAULT 'discovered',
    first_seen         TEXT,
    last_seen          TEXT,
    managed_by_lc      TEXT,
    region             TEXT,
    version            INTEGER     NOT NULL DEFAULT 0,
    metadata           TEXT        DEFAULT '{}'
);
```

| Field | Type | Notes |
|-------|------|-------|
| `device_id` | `TEXT PK` | Format: `nib-dev-{sequence}`. Assigned by NIBStore on first insert. |
| `mac_address` | `TEXT UNIQUE` | Hardware address. The canonical deduplication key across all discovery protocols. |
| `ip_address` | `TEXT NOT NULL` | Last observed IP. May change between discovery cycles. |
| `status` | `TEXT` | `discovered` \| `active` \| `inactive` \| `unreachable` \| `quarantined` |
| `managed_by_lc` | `TEXT` | Controller ID of the LC responsible for this device. |
| `version` | `INTEGER` | Incremented on every successful write. Used for optimistic locking. |
| `metadata` | `TEXT (JSON)` | Extended attributes — see Metadata Store below. |

**Python model:**

```python
@dataclass
class Device(NetworkEntity):
    data_tier: str = "transient"
    mac_address: str = ""
    ip_address: str = ""
    hostname: Optional[str] = None
    vendor: Optional[str] = None
    device_type: str = "unknown"
    region: str = ""
    local_controller: str = ""
    status: DeviceStatus = DeviceStatus.QUARANTINED
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
```

**`DeviceStatus` enum:**

| Value | Meaning |
|-------|---------|
| `discovered` | Seen in scan, not yet fully validated |
| `active` | Reachable, responding normally |
| `inactive` | Not seen for `missed_cycles_before_inactive` consecutive cycles |
| `unreachable` | Seen in ARP but not responding to ICMP or SNMP |
| `quarantined` | Flagged for review — automated changes blocked |
| `failed` | Device in an error state requiring manual intervention |

---

## Metadata Store

Extended device attributes stored as JSON alongside the Device Table record. One-to-one with Device Table.

```python
{
    "snmp_info": {
        "system_description": "Cisco IOS Software, Version 15.2...",
        "system_name": "sw-access-01",
        "uptime_seconds": 2592000
    },
    "interface_list": [
        {"name": "GigabitEthernet0/1", "status": "up", "speed": "1000Mbps"}
    ],
    "protocol_caps": ["OSPF", "STP", "LLDP"],
    "custom_tags": {
        "environment": "production",
        "criticality": "high"
    }
}
```

---

## Config Table

Tracks every configuration proposal and its complete approval lifecycle.

```sql
CREATE TABLE configs (
    config_id          TEXT        PRIMARY KEY,
    device_id          TEXT        NOT NULL,
    config_data        TEXT        NOT NULL,
    status             TEXT        NOT NULL DEFAULT 'proposed',
    proposed_by        TEXT,
    approved_by        TEXT,
    proposed_at        TEXT,
    approved_at        TEXT,
    applied_at         TEXT,
    reason             TEXT,
    version            INTEGER     NOT NULL DEFAULT 0,
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
);
```

| Field | Type | Notes |
|-------|------|-------|
| `config_id` | `TEXT PK` | UUID. |
| `device_id` | `TEXT FK` | References `devices.device_id`. |
| `config_data` | `TEXT (JSON)` | The full configuration payload. |
| `status` | `TEXT` | See `ConfigStatus` enum below. |
| `proposed_by` | `TEXT` | Controller ID — not a human name. |
| `approved_by` | `TEXT` | Controller ID of approving RC or GC. |
| `reason` | `TEXT` | Rejection reason on denied proposals. |

**`ConfigStatus` enum:**

| Value | Meaning |
|-------|---------|
| `proposed` | Submitted, awaiting RC classification |
| `approved` | Approved, execution token issued |
| `rejected` | Denied by RC or GC |
| `applied` | Successfully executed on target device |
| `failed` | Execution failed, awaiting rollback or manual review |

---

## Policy Table

Holds the active policy set distributed from the Global Controller downward.

```sql
CREATE TABLE policies (
    policy_id          TEXT        PRIMARY KEY,
    name               TEXT        NOT NULL,
    rule_set           TEXT        NOT NULL,
    scope              TEXT        NOT NULL,
    active             INTEGER     NOT NULL DEFAULT 1,
    created_by         TEXT        NOT NULL,
    created_at         TEXT,
    updated_at         TEXT,
    version            INTEGER     NOT NULL DEFAULT 0
);
```

| Field | Type | Notes |
|-------|------|-------|
| `scope` | `TEXT` | `global` \| `regional` \| `local` \| region slug (e.g. `zone-A`) |
| `rule_set` | `TEXT (JSON)` | The full policy rules as structured data. |
| `active` | `INTEGER` | `1` = active, `0` = superseded. Superseded policies are retained for 30 days. |

---

## Event Log

The immutable audit trail. Every significant action writes a signed entry. No UPDATE or DELETE is permitted — enforced by database trigger.

```sql
CREATE TABLE events (
    event_id           TEXT        PRIMARY KEY,
    event_type         TEXT        NOT NULL,
    controller_id      TEXT        NOT NULL,
    timestamp          TEXT        NOT NULL,
    details            TEXT        NOT NULL,
    signature          TEXT        NOT NULL
);

-- Immutability triggers
CREATE TRIGGER prevent_event_update
BEFORE UPDATE ON events
BEGIN
    SELECT RAISE(FAIL, 'Event log is immutable — updates not allowed');
END;

CREATE TRIGGER prevent_event_delete
BEFORE DELETE ON events
BEGIN
    SELECT RAISE(FAIL, 'Event log is immutable — deletions not allowed');
END;
```

| Field | Type | Notes |
|-------|------|-------|
| `event_type` | `TEXT` | See event type reference below. |
| `controller_id` | `TEXT` | The controller that wrote this entry — the `actor`. |
| `details` | `TEXT (JSON)` | `{"actor": "...", "subject": "...", "action": "...", "decision": "..."}` |
| `signature` | `TEXT` | `HMAC-SHA256(event_type + controller_id + timestamp + details, secret_key)` |

**Event type reference:**

| Category | Event types |
|----------|------------|
| Discovery | `DEVICE_DISCOVERED`, `DEVICE_UPDATED`, `DEVICE_INACTIVE`, `DISCOVERY_REPORT_SENT`, `DISCOVERY_REPORT_RECEIVED`, `DISCOVERY_CYCLE_FAILED`, `LC_DISCOVERY_OVERDUE` |
| Anomaly | `ANOMALY_CROSS_REGION_DEVICE`, `ANOMALY_DISCOVERY_SPIKE`, `ANOMALY_GLOBAL_MAC_COLLISION` |
| Config | `CONFIG_PROPOSED`, `CONFIG_APPROVED`, `CONFIG_DENIED`, `CONFIG_ESCALATED`, `CONFIG_EXECUTED`, `CONFIG_ROLLED_BACK`, `DEVICE_DEGRADED`, `EMERGENCY_EXECUTION` |
| Validation | `CONTROLLER_VALIDATED`, `VALIDATION_COMMIT_FAILURE` |
| Policy | `POLICY_UPDATED`, `POLICY_VERSION_MISMATCH` |

---

## Controller Sync Table

Manages coordination locks during multi-step operations.

```sql
CREATE TABLE locks (
    lock_id            TEXT        PRIMARY KEY,
    subject_id         TEXT        NOT NULL,
    lock_type          TEXT        NOT NULL,
    held_by            TEXT        NOT NULL,
    acquired_at        TEXT        NOT NULL,
    expires_at         TEXT        NOT NULL
);
```

| Field | Type | Notes |
|-------|------|-------|
| `subject_id` | `TEXT` | The resource being locked — a `device_id`, `config_id`, or controller ID. |
| `lock_type` | `TEXT` | `config_approval` \| `device_assignment` \| `policy_update` |
| `held_by` | `TEXT` | Controller ID holding the lock. Only this controller can release it. |
| `expires_at` | `TEXT` | ISO-8601 UTC. Locks are always time-bounded — default TTL 15 minutes. |

**`LockType` enum:**

| Value | Used during |
|-------|------------|
| `config_approval` | Held per target device for the full approval → execution lifecycle |
| `device_assignment` | Held when reassigning a device between LCs |
| `policy_update` | Held during policy write to prevent concurrent policy conflicts |

---

## Controller identity records

Stored in the `controllers` table after successful validation.

```sql
CREATE TABLE controllers (
    controller_id      TEXT        PRIMARY KEY,
    role               TEXT        NOT NULL,
    region             TEXT,
    status             TEXT        NOT NULL DEFAULT 'validating',
    validated_by       TEXT,
    validated_at       TEXT,
    public_key         TEXT,
    certificate        TEXT,
    capabilities       TEXT        DEFAULT '[]',
    metadata           TEXT        DEFAULT '{}',
    version            INTEGER     NOT NULL DEFAULT 0
);
```

| Field | Type | Notes |
|-------|------|-------|
| `controller_id` | `TEXT PK` | Format: `{type}_cntl_{region}_{sequence}`. Assigned by validating controller. |
| `role` | `TEXT` | `global` \| `regional` \| `local` |
| `status` | `TEXT` | `validating` \| `active` \| `inactive` \| `suspended` |
| `validated_by` | `TEXT` | Controller ID that issued this controller's certificate. |
| `certificate` | `TEXT (JSON)` | Signed certificate object. |
| `capabilities` | `TEXT (JSON array)` | e.g. `["discovery", "approval", "policy_enforcement"]` |

---

## NIBResult

Every NIBStore method that modifies state returns a `NIBResult`. Callers must check it before proceeding.

```python
@dataclass
class NIBResult:
    success: bool
    error: Optional[str] = None   # Human-readable error description
    data: Optional[Any] = None    # Return value on success (e.g. device_id after insert)
    conflict: bool = False        # True when a write failed due to version mismatch
```

**Handling results correctly:**

```python
# Wrong — assumes success
nib.upsert_device(device)

# Right — checks result
result = nib.upsert_device(device)
if not result.success:
    if result.conflict:
        # Re-read and retry
    else:
        raise StorageError(result.error)
```

---

## Indexes

```sql
CREATE INDEX idx_devices_mac      ON devices(mac_address);
CREATE INDEX idx_devices_region   ON devices(region);
CREATE INDEX idx_configs_device   ON configs(device_id);
CREATE INDEX idx_events_type      ON events(event_type);
CREATE INDEX idx_events_controller ON events(controller_id);
CREATE INDEX idx_locks_subject    ON locks(subject_id, lock_type);
```

---

## Related pages

- [Network Information Base](../concepts/network-information-base.md) — consistency model, write protocol, two-tier classification
- [API reference](api-reference.md) — message payloads that reference these schemas
- [Deployment guide](deployment-guide.md) — NIB initialisation and backend configuration
