# Communication model

This page covers how PDSNO controllers communicate — which protocols are used between which tiers, the message envelope format, how messages are authenticated, and the timeout and retry contracts that govern reliability.

---

## Protocol assignment

PDSNO uses two protocols, chosen based on message type rather than convenience:

| Protocol | Used for | Direction | Why |
|----------|----------|-----------|-----|
| **REST / HTTP** | Validation, config approval, discovery reports | Point-to-point, synchronous | Request-response — the sender needs a definite answer before proceeding |
| **MQTT pub/sub** | Policy distribution, state change events, NIB sync notifications | Broadcast | One publisher, many subscribers — polling would waste bandwidth and add latency |

This split is validated by SDN research (Alsheikh et al., ARO 2024): pub/sub is strictly better than polling for state updates in distributed controller systems. REST is appropriate for flows with a definite outcome; MQTT is appropriate for flows that are announcements.

### When to use which

**Use REST when:** the sending controller needs to know the outcome before taking its next action. Validation (does this controller get a certificate?), config approval (is this change approved?), and discovery reports (did the RC accept this?) all have a definite answer that the sender must wait for.

**Use MQTT when:** the sending controller is announcing something to multiple subscribers and does not need individual acknowledgement. Policy updates go to all RCs simultaneously — addressing each RC individually with REST would require the GC to know every RC's address and to send N requests. With MQTT, the GC publishes once and all subscribers receive it.

---

## Interface naming

PDSNO follows ONF TR-521 standard interface naming throughout:

| Interface | ONF name | Direction | Purpose |
|-----------|----------|-----------|---------|
| **NBI** (Northbound) | A-CPI | Controller → Applications above | Exposes orchestration capabilities to external tools, dashboards, and vendor adapters |
| **SBI** (Southbound) | D-CPI | Controller → Devices below | Communicates with managed devices via NETCONF, SNMP, ARP, ICMP |
| **East/West** | Inter-Controller | Controller ↔ Controller | Peer communication at the same tier; also used for the hierarchical flows |

Using ONF naming means PDSNO speaks the same architectural language as the rest of the SDN industry. A network engineer who has worked with any SDN system immediately understands what NBI and SBI mean without explanation.

---

## Delta-sync principle

Controllers only exchange what changed — never full state dumps.

Every NIB entity has a `version` integer and an `updated_at` timestamp. When a controller processes a change, it publishes the changed entity to the relevant MQTT topic — not the full table. Subscribing controllers receive the delta and merge it into their local NIB view.

A naive implementation would have controllers periodically exchange their full state to stay synchronised. This works at small scale and fails at large scale: synchronisation traffic grows with the number of devices and the frequency of updates. Delta-sync keeps inter-controller traffic proportional to what actually changed, not to the total size of the network.

**Reconnection resync** — if a controller has been offline, it cannot rely on the delta stream to reconstruct what it missed. On reconnect, it requests a full resync for the period it was absent. This is the one legitimate exception to delta-only exchange, and it is the exception that proves the rule: it only happens after an outage, not as part of normal operation.

---

## Message envelope

Every message exchanged between PDSNO controllers uses a standard envelope, regardless of which protocol carries it:

```json
{
  "envelope": {
    "message_id": "msg-abc123",
    "message_type": "VALIDATION_REQUEST",
    "sender_id": "regional_cntl_zoneA_1",
    "recipient_id": "global_cntl_1",
    "timestamp": "2026-02-16T10:30:00.000Z",
    "signature": "hmac-sha256-hex",
    "schema_version": "1.0"
  },
  "payload": {
    ...
  }
}
```

| Field | Required | Purpose |
|-------|----------|---------|
| `message_id` | Yes | Unique identifier — used for deduplication and audit correlation |
| `message_type` | Yes | One of the defined message types from the API reference |
| `sender_id` | Yes | The validated controller ID of the sender — not a self-reported claim |
| `recipient_id` | Yes | The target controller ID — recipients verify this matches themselves |
| `timestamp` | Yes | UTC timestamp — used for replay attack prevention |
| `signature` | Yes | HMAC-SHA256 of canonical JSON of `envelope + payload` |
| `schema_version` | Yes | Allows future backwards-compatible envelope changes |

### Message authentication

Every message must be signed. Recipients reject unsigned messages unconditionally — there is no opt-out and no degraded-trust mode for unsigned messages.

**PoC (Phases 1–5):** HMAC-SHA256 with a shared secret per controller pair. Shared secrets are established during the key exchange phase (Phase 6D: Diffie-Hellman Ephemeral) and stored in the controller's key manager.

**Phase 6+:** Ed25519 asymmetric signatures using the private key issued during controller validation. Any controller can verify any other controller's messages using the public key stored in the NIB — no shared secret required.

### Replay attack prevention

Two mechanisms work together:

**Timestamp freshness** — recipients reject any message whose `timestamp` is older than `FRESHNESS_WINDOW` (default: 5 minutes, configurable in policy). This alone is not sufficient — a replay within the freshness window would pass.

**Nonce deduplication** — each message carries a unique random nonce. Recipients maintain a short-lived cache of recently seen nonces and reject any duplicate within the freshness window. A captured message replayed within 5 minutes is caught by the nonce check.

---

## MQTT topic structure

```
pdsno/
├── discovery/{region}/{lc_id}      ← LC publishes, RC subscribes (wildcard: +)
├── policy/global                   ← GC publishes, all RCs subscribe
├── policy/{region}                 ← RC publishes, all LCs in region subscribe
├── events/system                   ← System-wide notifications
├── events/{region}                 ← Region-specific events
└── status/{controller_id}          ← Controller heartbeats
```

**Wildcard subscriptions** — Regional Controllers subscribe to `pdsno/discovery/{region}/+` — the `+` wildcard matches any LC ID in their region. Adding a new Local Controller requires only configuring its region; the RC's subscription automatically covers it. No RC configuration change is needed.

**Retained messages** — policy topics use `retain: true`. This means a new subscriber receives the latest policy immediately upon subscribing, without waiting for the next policy update. A Local Controller that comes online after a policy update does not miss it.

**QoS levels:**
- `QoS 1` (at-least-once) — discovery reports, state updates. Duplicates are handled by the receiver's idempotency logic.
- `QoS 2` (exactly-once) — policy distribution. Policy version mismatches cause proposal rejections, so duplicate delivery must be prevented.

---

## Phase-by-phase implementation

### Phases 1–5: in-process message bus

Controllers communicate via direct Python function calls wrapped in message envelope objects. No network involved. The same envelope format is used — this ensures the Phase 6 transition to REST/MQTT requires only swapping the transport layer, not the message format or any controller logic.

### Phase 6: REST + MQTT

- Each controller runs a FastAPI server exposing REST endpoints for each request-response message type
- Each controller connects to a shared MQTT broker (Mosquitto for development, EMQX for production)
- Message authentication is enforced at every endpoint — requests without a valid signature return `401 Unauthorized`
- Mutual TLS is added for REST connections

### Phase 6+: full production

- MQTT QoS 2 for policy distribution and audit events; QoS 1 for state updates
- Ed25519 asymmetric signatures replacing HMAC
- Certificate-level mTLS in addition to message-level signatures

---

## Timeout and retry contracts

Every request-response exchange has a defined timeout and retry behaviour. These are not arbitrary — they are derived from the operational requirements of each flow.

| Message type | Timeout | Retries | On final failure |
|-------------|---------|---------|-----------------|
| Validation challenge-response | 30s | 0 | Reject; write audit entry; require new flow |
| Config approval (LC → RC) | 60s | 3 (exponential backoff) | Queue locally; retry after `policy.rc_retry_interval` |
| Config escalation (RC → GC) | 300s | 0 | Default DENY; release all locks |
| Discovery report submission | 30s | 3 | Log failure; RC initiates reconciliation |
| Policy distribution | N/A (MQTT handles delivery) | N/A | MQTT QoS guarantees delivery |

**Exponential backoff rule** — retry 1 waits 1s, retry 2 waits 2s, retry 3 waits 4s. Each wait adds ±20% random jitter to prevent thundering herd when multiple controllers retry simultaneously after a network partition resolves.

**Default-deny on timeout** — the config escalation timeout is the most consequential. If the GC does not respond within 300 seconds, the RC defaults to DENY and releases all device locks. This safe-fail default prevents a GC outage from leaving approvals in an indefinite pending state that blocks all HIGH-sensitivity changes.

---

## What controllers must not do

These are communication anti-patterns that the architecture explicitly prohibits:

**No direct NIB-to-NIB communication.** Controllers do not reach into another controller's NIB directly. All state sharing goes through the defined message types and the local NIB view update process.

**No polling for state updates.** Controllers do not periodically ask other controllers "what has changed?" — they subscribe to MQTT topics and receive updates when changes happen. The one exception is the full resync after a controller reconnects from an outage.

**No self-asserted identity in messages.** A controller cannot send a message claiming to be `global_cntl_1` — the recipient verifies the signature against the public key registered for that controller ID in the NIB. Identity is cryptographically verified, not taken on faith.

**No unbounded message sizes.** Large payloads must be chunked or referenced by ID. The NIB stores the payload; messages carry a reference to it. This prevents any single message from overwhelming a controller's message queue.

---

## Related pages

- [Controller hierarchy](controller-hierarchy.md) — which controllers talk to which
- [Controller validation](controller-validation.md) — how controller identities used in signatures are established
- [Policy propagation](policy-propagation.md) — the MQTT policy distribution flow in detail
- [API reference](../reference/api-reference.md) — all message types, payload schemas, and endpoint definitions