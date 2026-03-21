# Policy propagation

Policy in PDSNO flows in one direction: downward from the Global Controller. This page covers how policy is created, distributed, versioned, and enforced — and why the one-directional design is not a constraint but a deliberate correctness guarantee.

---

## What policy controls

Policy is the set of rules that governs what PDSNO controllers are permitted to do. It is not network configuration — it is the meta-layer that determines how network configuration changes can be proposed, approved, and executed.

Policy controls:

- Which subnets a Local Controller is permitted to scan, and with which protocols
- Which sensitivity tiers require which approval paths
- Discovery intervals, missed-cycle thresholds, anomaly detection thresholds
- Rate limits for emergency mode invocations
- Maximum controllers per region and type
- Escalation triggers and blast-radius thresholds

Every operational decision a controller makes — whether to auto-approve a LOW change, whether to flag a discovery spike as anomalous, whether to escalate to the GC — is evaluated against the active policy version.

---

## The propagation flow

```
Global Controller
    Policy created or updated
    Write to NIB Policy Table (global scope)
    Publish POLICY_UPDATE to: pdsno/policy/global (MQTT, QoS 2, retain: true)
         │
         ▼
Regional Controllers (subscribed to pdsno/policy/global)
    Receive delta → validate signature + version
    Write to regional NIB Policy Table
    Publish POLICY_UPDATE to: pdsno/policy/{region} (MQTT, QoS 2, retain: true)
         │
         ▼
Local Controllers (subscribed to pdsno/policy/{region})
    Receive delta → validate signature + version
    Write to local NIB Policy Table
    All future proposals reference the new policy version
```

**QoS 2 (exactly-once delivery)** is used for policy distribution — the only place in PDSNO where exactly-once matters at the transport level. Because every proposal must reference a policy version, and mismatched versions cause proposal rejections, a duplicated policy update that increments the version twice would break in-flight proposals. QoS 2 prevents this.

**Retain: true** ensures new subscribers receive the latest policy immediately upon subscribing. A Local Controller that comes online after a policy update does not need to wait for the next policy publish cycle — it receives the retained message on subscription.

---

## Policy versioning

Every policy record carries a `policy_version` string (e.g. `region1-v3.2`). This version is:

- Included in every `POLICY_UPDATE` message
- Required in every `CONFIG_PROPOSAL` — the LC must declare which policy version it was operating under when it built the proposal
- Checked by the RC before approving any proposal — the proposal's version must match the RC's current active version

**Version mismatch = rejection.** A proposal submitted under an outdated policy version is rejected with `POLICY_VERSION_MISMATCH`. The LC receives the current version in the rejection response and can update and retry.

This is not a harsh constraint — it is what prevents a change from being evaluated against stale rules. If a security policy was tightened and a proposal was submitted just before the LC received the update, the RC's version check catches it.

---

## Why policy is write-once from the top

Regional and Local Controllers never write to the Policy Table directly. Policy writes are serialised through the Global Controller exclusively. This design makes policy conflicts impossible by construction.

In a model where RCs could write policy for their own zone, two problems arise immediately:

**Conflict resolution becomes complex.** If RC-A and RC-B both have the authority to write zone-level policy, and they write conflicting rules, the system needs a merge strategy. Every possible merge strategy has edge cases that produce incorrect behaviour. PDSNO avoids this problem by eliminating the case entirely.

**The audit trail becomes ambiguous.** If policy can be written at multiple levels, reconstructing "what policy was in effect when this change was approved" requires understanding the precedence rules between layers. With a single write path, the answer is always simple: the GC wrote it, the RCs propagated it, the LCs applied it.

---

## Policy scope

Each policy record has a `scope` field that determines which controllers it applies to:

| Scope | Applies to | Set by |
|-------|-----------|--------|
| `global` | All controllers in the network | Global Controller |
| `regional` | All controllers in a specific zone | Global Controller (distributed via RC) |
| `local` | Controllers in a specific subnet block | Global Controller (distributed via RC → LC) |

Regional and Local Controllers receive scoped policy — they do not receive the full global policy object. An LC in `zone-A` receives the global baseline plus the `zone-A` regional overlay plus any subnet-specific policy for its assigned subnets.

---

## Policy enforcement points

Policy is not enforced by a single component — it is checked at every tier independently.

**At the Local Controller:**
- Scan targets and permitted protocols come from local policy
- LOW sensitivity changes are auto-approved only if local policy permits `allow_local_exec: true`
- Emergency rate limits are enforced locally

**At the Regional Controller:**
- Sensitivity re-classification uses regional policy
- Escalation triggers (blast radius threshold, critical device flags) come from regional policy
- LC quota per region is enforced regionally

**At the Global Controller:**
- Immutable policy rules that cannot be overridden by any lower tier
- Cross-region change limits
- Global RC quota

---

## Policy drift

Policy drift — where a controller is operating under a different version than its peers — is an expected transient state, not an error. It occurs in the window between when the GC publishes a policy update and when all controllers have received and applied it.

PDSNO handles this through the proposal version check rather than trying to prevent drift entirely:

1. GC publishes `policy v3.2`
2. RC receives and applies `v3.2`
3. LC has not yet received `v3.2` — it is still on `v3.1`
4. LC submits a proposal referencing `v3.1`
5. RC rejects the proposal with `POLICY_VERSION_MISMATCH` and includes `v3.2` in the response
6. LC receives `v3.2` (either from the rejection response or from its own MQTT subscription arriving moments later)
7. LC resubmits the proposal referencing `v3.2`

This sequence is normal and expected. The retry adds at most a few seconds of latency in practice. Importantly, no change is ever evaluated under the wrong policy — the version check guarantees this.

---

## Immutable policy rules

The Global Controller can flag specific policy rules as `immutable`. Immutable rules:

- Cannot be overridden by regional or local policy
- Cannot be bypassed by escalation — even if the GC later approves a change, an immutable rule denial at the GC's own check stands
- Are checked first at the GC before any other evaluation in Stage 4 of the config approval flow

Immutable rules are the mechanism for expressing organisation-wide security mandates that must hold regardless of operational circumstances. Examples: "no configuration changes may disable firewall logging on edge devices," "no BGP changes may affect more than 3 regions simultaneously."

---

## Scan policy

The scan policy is a specific subset of local policy that governs discovery behaviour. It is distributed via the same propagation mechanism but deserves separate mention because it is the primary operational input that Local Controllers act on.

Key scan policy fields:

```yaml
allowed_networks:
  - interface: eth0
    cidr: 10.10.20.0/24

allowed_protocols:
  - arp
  - icmp
  - snmpv2c

schedule:
  window_start: "00:00"
  window_end: "06:00"
  max_scans_per_hour: 4

resource_limits:
  max_threads: 20
  max_concurrent_probes: 100
  probe_timeout_seconds: 2

safety:
  max_packet_rate_per_device: 200
  respect_device_blacklist: true
```

A Local Controller that receives no scan targets in its active policy skips the discovery cycle entirely. It does not scan anything not explicitly permitted by policy. This is enforced by the LC — it is not a trust property of the system (a compromised LC could scan anyway), but it is correct behaviour for a legitimate LC.

→ Full scan policy schema: [Scan policy](../reference/scan-policy.md)

---

## Policy update message structure

```json
{
  "policy_id": "uuid",
  "policy_version": "region1-v3.3",
  "scope": "regional",
  "target_region": "zone-A",
  "content": { ... },
  "distributed_by": "global_cntl_1",
  "valid_from": "2026-02-16T12:00:00Z"
}
```

The `valid_from` field allows the GC to schedule policy updates — the receiving controller applies the new policy only after the specified time, giving the operator a window to roll back a policy change if something looks wrong after distribution but before it takes effect.

---

## Related pages

- [Communication model](communication-model.md) — MQTT topics, QoS levels, and retention
- [Config approval](config-approval.md) — how policy version is enforced during proposal evaluation
- [Device discovery](device-discovery.md) — how scan policy governs discovery behaviour
- [Scan policy](../reference/scan-policy.md) — full policy schema reference
- [API reference](../reference/api-reference.md) — POLICY_UPDATE message schema