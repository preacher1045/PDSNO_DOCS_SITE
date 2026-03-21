# API reference

This page catalogs every defined inter-controller message type in PDSNO — its direction, transport protocol, required payload fields, and expected response. All messages use the standard envelope defined in the [Communication model](../concepts/communication-model.md).

---

## Standard message envelope

Every message, regardless of type or transport, wraps its payload in this envelope:

```json
{
  "message_id": "msg-abc123",
  "message_type": "VALIDATION_REQUEST",
  "sender_id": "regional_cntl_zoneA_1",
  "recipient_id": "global_cntl_1",
  "timestamp": "2026-02-16T10:30:00.000Z",
  "signature": "hmac-sha256-hex",
  "schema_version": "1.0",
  "payload": { ... }
}
```

Recipients reject any message missing a valid `signature`. There is no unsigned path.

---

## Controller validation messages

### `VALIDATION_REQUEST`

**Direction:** Unvalidated controller → GC (for RC) or RC (for LC)
**Transport:** REST POST to `/message/validation_request`

```json
{
  "temp_id": "temp-<uuid>",
  "controller_type": "regional | local",
  "region": "zone-A",
  "public_key": "<base64 Ed25519 pubkey>",
  "bootstrap_token": "<hmac-sha256>",
  "metadata": {
    "hostname": "rc-zone-a-01",
    "ip_address": "10.0.1.5",
    "software_version": "0.1.0",
    "capabilities": ["discovery", "approval", "policy_enforcement"]
  }
}
```

**Response:** `CHALLENGE`

---

### `CHALLENGE`

**Direction:** Validating controller → Requesting controller
**Transport:** REST response to `VALIDATION_REQUEST`

```json
{
  "challenge_id": "challenge-xxxxxxxxxxxx",
  "temp_id": "temp-<uuid>",
  "nonce": "<base64 32-byte random>",
  "issued_at": "2026-02-16T10:30:00Z",
  "expires_at": "2026-02-16T10:30:30Z"
}
```

The challenge expires 30 seconds after `issued_at`. No response received within the window results in `CHALLENGE_TIMEOUT`.

---

### `CHALLENGE_RESPONSE`

**Direction:** Requesting controller → Validating controller
**Transport:** REST POST to `/message/challenge_response`

```json
{
  "challenge_id": "challenge-xxxxxxxxxxxx",
  "temp_id": "temp-<uuid>",
  "signed_nonce": "<base64 Ed25519 signature of nonce>"
}
```

**Response:** `VALIDATION_RESULT`

---

### `VALIDATION_RESULT`

**Direction:** Validating controller → Requesting controller
**Transport:** REST response to `CHALLENGE_RESPONSE`

```json
{
  "status": "APPROVED | REJECTED | ERROR",
  "assigned_id": "regional_cntl_zoneA_1",
  "certificate": {
    "assigned_id": "regional_cntl_zoneA_1",
    "role": "regional",
    "region": "zone-A",
    "public_key": "<base64 pubkey>",
    "issued_by": "global_cntl_1",
    "issued_at": "2026-02-16T10:30:00Z",
    "signature": "<hmac-sha256>"
  },
  "delegation_credential": null,
  "role": "regional",
  "region": "zone-A",
  "reason": "INVALID_BOOTSTRAP_TOKEN"
}
```

`delegation_credential` is non-null only when a GC validates an RC — it grants the RC authority to validate LCs in its zone. `reason` is only populated on `REJECTED` or `ERROR` status.

**Rejection reason codes:** `STALE_TIMESTAMP`, `FUTURE_TIMESTAMP`, `BLOCKLISTED`, `INVALID_BOOTSTRAP_TOKEN`, `UNKNOWN_CHALLENGE`, `CHALLENGE_EXPIRED`, `TEMP_ID_MISMATCH`, `INVALID_SIGNATURE`, `CHALLENGE_TIMEOUT`, `CONTROLLER_TYPE_NOT_PERMITTED`, `INVALID_REGION`, `REGION_NOT_SERVED_BY_THIS_RC`, `CONTROLLER_QUOTA_EXCEEDED`, `IDENTITY_ASSIGNMENT_FAILED`

---

## Key exchange messages (Phase 6D)

### `KEY_EXCHANGE_INIT`

**Direction:** Initiating controller → Peer controller
**Transport:** REST POST to `/message/key_exchange_init`
**Note:** This message is sent **unsigned** — no shared secret exists yet.

```json
{
  "initiator_id": "regional_cntl_zoneA_1",
  "responder_id": "global_cntl_1",
  "public_key": "<PEM-encoded DH public key>",
  "timestamp": "2026-02-16T10:30:00Z"
}
```

**Response:** `KEY_EXCHANGE_RESPONSE`

---

### `KEY_EXCHANGE_RESPONSE`

**Direction:** Responding controller → Initiating controller
**Transport:** REST response to `KEY_EXCHANGE_INIT`

```json
{
  "initiator_id": "regional_cntl_zoneA_1",
  "responder_id": "global_cntl_1",
  "public_key": "<PEM-encoded DH public key>",
  "timestamp": "2026-02-16T10:30:00Z"
}
```

After receiving this, the initiator calls `finalize_key_exchange()` to compute the shared secret. Both controllers now have an identical 32-byte HKDF-derived key stored under `key_{controller_a}_{controller_b}` in their key managers. All subsequent messages are signed with this key.

---

## Discovery messages

### `DISCOVERY_REQUEST`

**Direction:** RC or GC → LC
**Transport:** REST POST to `/message/discovery_request`

```json
{
  "request_id": "uuid",
  "trigger": "SCHEDULED | ON_DEMAND | BOOTSTRAP | RC_REQUESTED_OVERDUE",
  "subnets": ["192.168.1.0/24"],
  "protocols": ["arp", "icmp", "snmp"]
}
```

---

### `DISCOVERY_REPORT`

**Direction:** LC → RC
**Transport:** REST POST to `/message/discovery_report` or MQTT `pdsno/discovery/{region}/{lc_id}`

```json
{
  "report_id": "uuid",
  "lc_id": "local_cntl_zoneA_1",
  "region": "zone-A",
  "scan_start": "2026-02-16T10:00:00Z",
  "scan_end": "2026-02-16T10:02:13Z",
  "new_devices": [
    {
      "mac_address": "aa:bb:cc:dd:ee:ff",
      "ip_address": "192.168.1.45",
      "vendor": "Cisco",
      "hostname": "sw-access-01",
      "discovery_method": "arp"
    }
  ],
  "updated_devices": [
    {
      "entity_id": "nib-dev-001",
      "mac_address": "aa:bb:cc:00:11:22",
      "ip_address": "192.168.1.10",
      "status": "active"
    }
  ],
  "inactive_devices": ["nib-dev-003", "nib-dev-007"],
  "total_devices_seen": 47,
  "write_summary": {
    "new": 1,
    "updated": 1,
    "inactive": 2,
    "conflicts": 0
  },
  "policy_version": "region1-v3.2"
}
```

**Response:** `DISCOVERY_REPORT_ACK`

---

### `DISCOVERY_REPORT_ACK`

**Direction:** RC → LC
**Transport:** REST response to `DISCOVERY_REPORT`

```json
{
  "status": "received",
  "devices_processed": 49,
  "collisions_detected": 0
}
```

---

### `DISCOVERY_SUMMARY`

**Direction:** RC → GC
**Transport:** REST POST to `/message/discovery_summary`

```json
{
  "summary_id": "uuid",
  "rc_id": "regional_cntl_zoneA_1",
  "region": "zone-A",
  "cycle_start": "2026-02-16T10:00:00Z",
  "cycle_end": "2026-02-16T10:02:30Z",
  "total_new": 1,
  "total_updated": 1,
  "total_inactive": 2,
  "total_devices_in_region": 134,
  "anomalies_flagged": [],
  "lcs_reported": ["local_cntl_zoneA_1", "local_cntl_zoneA_2"],
  "lcs_missing": []
}
```

---

## Configuration approval messages

### `CONFIG_PROPOSAL`

**Direction:** LC → RC
**Transport:** REST POST to `/message/config_proposal`

```json
{
  "proposal_id": "uuid",
  "config_payload": { },
  "config_hash": "sha256-hex",
  "target_devices": ["nib-dev-001"],
  "suggested_sensitivity": "MEDIUM",
  "impact_scope": "regional",
  "rollback_payload": { },
  "timestamp": "2026-02-16T10:30:00Z",
  "policy_version": "region1-v3.2",
  "origin": "local_cntl_zoneA_1",
  "origin_signature": "hmac-sha256-hex"
}
```

`rollback_payload` is required for MEDIUM and HIGH sensitivity proposals. Proposals without it are rejected.

---

### `APPROVAL_RESPONSE`

**Direction:** RC → LC (LOW/MEDIUM) or GC → RC (HIGH)
**Transport:** REST response to `CONFIG_PROPOSAL`

```json
{
  "proposal_id": "uuid",
  "decision": "APPROVE | DENY | ESCALATE",
  "responder": "regional_cntl_zoneA_1",
  "timestamp": "2026-02-16T10:30:05Z",
  "responder_signature": "hmac-sha256-hex",
  "reason": "POLICY_VERSION_MISMATCH",
  "escalation_target": null
}
```

`reason` is populated on `DENY`. `escalation_target` is populated on `ESCALATE`.

---

### `EXECUTION_INSTRUCTION`

**Direction:** RC → LC
**Transport:** REST POST to `/message/execution_instruction`

```json
{
  "proposal_id": "uuid",
  "execution_token": {
    "token_id": "uuid",
    "proposal_id": "uuid",
    "config_hash": "sha256-hex",
    "target_devices": ["nib-dev-001"],
    "approved_by": "regional_cntl_zoneA_1",
    "issued_at": "2026-02-16T10:30:05Z",
    "expires_at": "2026-02-16T10:40:05Z",
    "constraints": {
      "max_devices_per_minute": 10,
      "rollback_required_on_failure": true,
      "maintenance_window_required": false
    },
    "signature": "hmac-sha256-hex"
  },
  "execute_at": null
}
```

`execute_at` is null for immediate execution. A non-null value schedules execution for a future time (maintenance window use case, planned for Phase 7+).

---

### `EXECUTION_RESULT`

**Direction:** LC → RC
**Transport:** REST POST to `/message/execution_result`

```json
{
  "proposal_id": "uuid",
  "executor": "local_cntl_zoneA_1",
  "status": "EXECUTED | FAILED | ROLLED_BACK | DEGRADED",
  "device_results": {
    "nib-dev-001": "SUCCESS"
  },
  "timestamp": "2026-02-16T10:30:12Z",
  "execution_signature": "hmac-sha256-hex"
}
```

---

## Policy messages

### `POLICY_UPDATE`

**Direction:** GC → RC → LC
**Transport:** MQTT publish
- GC publishes to: `pdsno/policy/global`
- RC publishes to: `pdsno/policy/{region}`
- QoS 2 (exactly-once), `retain: true`

```json
{
  "policy_id": "uuid",
  "policy_version": "region1-v3.3",
  "scope": "global | regional | local",
  "target_region": "zone-A",
  "content": { },
  "distributed_by": "global_cntl_1",
  "valid_from": "2026-02-16T12:00:00Z"
}
```

---

## NBI REST endpoints (Phase 6)

The Global Controller exposes a Northbound Interface for external tools, dashboards, and vendor adapters. All endpoints require `Authorization: Bearer <token>`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | System health summary |
| `GET` | `/api/v1/controllers` | All registered controllers and their status |
| `GET` | `/api/v1/devices` | All devices in global NIB (filterable by region, status) |
| `GET` | `/api/v1/devices/{device_id}` | Single device record |
| `GET` | `/api/v1/devices/{device_id}/history` | Config history for a device |
| `GET` | `/api/v1/proposals` | Config proposals (filterable by status, sensitivity, region) |
| `GET` | `/api/v1/proposals/{proposal_id}` | Single proposal with full audit trail |
| `POST` | `/api/v1/proposals` | Submit config proposal from external tool |
| `GET` | `/api/v1/policy` | Active global policy |
| `PUT` | `/api/v1/policy` | Update global policy (authorised operators only) |
| `GET` | `/api/v1/audit` | Query Event Log (filterable by time, actor, event type) |

---

## MQTT topic reference

| Topic | Publisher | Subscriber | QoS | Retain |
|-------|-----------|-----------|-----|--------|
| `pdsno/discovery/{region}/{lc_id}` | LC | RC | 1 | No |
| `pdsno/policy/global` | GC | All RCs | 2 | Yes |
| `pdsno/policy/{region}` | RC | All LCs in region | 2 | Yes |
| `pdsno/events/system` | Any | Monitoring | 1 | No |
| `pdsno/events/{region}` | RC | Zone subscribers | 1 | No |
| `pdsno/status/{controller_id}` | Any | Monitoring | 0 | No |

---

## Related pages

- [Communication model](../concepts/communication-model.md) — protocol assignment and message authentication
- [Controller validation](../concepts/controller-validation.md) — validation flow and error codes
- [Config approval](../concepts/config-approval.md) — approval flow and execution tokens
- [Data models](data-models.md) — NIB entity schemas referenced by these messages
