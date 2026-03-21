# System goals

This page documents the explicit goals and deliberate tradeoffs that shape PDSNO's design. Understanding these is important for contributors — every significant architectural decision traces back to one or more of these goals.

---

## Core goals

### 1. Governance over performance

PDSNO accepts latency costs in exchange for governance correctness. A flat, peer-to-peer controller architecture delivers better raw performance for large-scale fluctuating networks. PDSNO's three-tier hierarchy adds latency on HIGH-sensitivity config approvals because changes must travel LC → RC → GC → RC → LC.

This is intentional. PDSNO is designed for environments where:

- A single, unambiguous root of trust for controller identity is required
- High-sensitivity changes need a verifiable chain of custody
- Policy conflicts must have a defined resolution authority — no ambiguity about which controller's policy wins

In environments where governance is less critical and performance is the primary concern, a flatter architecture is the better choice. PDSNO is not that system.

### 2. Every action is auditable

No change executes without a signed audit trail. No approval is granted without a record. The Event Log is append-only and tamper-evident. There is no silent path through the system.

This goal shapes several specific design decisions: execution tokens are cryptographically bound to the specific change they authorise, sensitivity re-classification happens independently at each tier (so a compromised lower tier cannot misreport), and rollback payloads are required at proposal time — not constructed after failure.

### 3. State lives in the NIB

No controller trusts its own memory for network facts. All state that matters is written to the Network Information Base before any action is taken based on it. If a controller's local state disagrees with the NIB, the NIB wins.

This eliminates an entire class of consistency bugs that arise when controllers maintain independent local state and diverge. The tradeoff is a dependency on NIB availability — accepted as worthwhile.

### 4. Interfaces are the contracts

Controllers communicate only through defined message types on defined interfaces (NBI, SBI, East/West). No controller reaches into another's internals. No controller accesses the storage layer directly — all NIB access goes through the `NIBStore` interface.

This makes the storage backend swappable (SQLite in the PoC, PostgreSQL + Redis in production) without changing any controller code.

### 5. Vendor neutrality

The adapter layer translates generic configuration intents into vendor-specific commands. The controller hierarchy, the NIB, the approval flow, and the audit trail operate identically regardless of whether the underlying devices are Cisco, Juniper, Arista, or anything that speaks NETCONF. No tier assumes any specific vendor.

---

## Deliberate non-goals

These are things PDSNO explicitly does not try to do, because doing them would compromise the goals above or because better tools already exist for them.

**Not a network monitoring tool.** PDSNO does not collect telemetry, generate performance alerts, or watch traffic. It governs changes and maintains state. Integrate with Prometheus, Grafana, or your existing monitoring stack for observability.

**Not a provisioning tool.** PDSNO does not bootstrap new devices from scratch. Devices are discovered after they are physically connected and reachable. Day-zero provisioning belongs to Ansible, Terraform, or vendor-native tools.

**Not a replacement for vendor UIs.** PDSNO centralises governance tasks — change approval, policy distribution, audit logging. Engineers still use vendor-native interfaces for complex vendor-specific configuration work. PDSNO aims to reduce how often engineers need to drop into those interfaces for governance tasks, not eliminate the interfaces.

**Not eventually consistent for critical operations.** Config approvals, controller identities, and policy distribution use strong consistency. A brief window where one controller approves a change that another has already approved — or that violates a policy update that hasn't arrived yet — can cause real damage. Eventual consistency is acceptable for device discovery (transient data), not for governance (durable data).

---

## Tradeoffs accepted

| Tradeoff | What was accepted | Why |
|----------|-------------------|-----|
| Latency on HIGH changes | LC→RC→GC round-trip adds seconds | Chain of custody requires it |
| NIB availability dependency | Controllers need NIB access to function | Eliminates consistency bugs worth the dependency |
| Bootstrap complexity | Controllers must be provisioned with tokens before they can join | Prevents rogue controllers — security over convenience |
| Rollback payload required upfront | Proposer must think about reversal before acting | Forces disciplined change management |
| Optimistic locking contention | Write conflicts possible under concurrent load | Simpler than distributed locking; retry is cheap |
| Single GC root of trust | GC offline = no new trust can be established | Accepted in v1; multi-GC consensus planned for Phase 6+ |

---

## Design principles for contributors

These are the rules that flow from the goals above. When making any design decision, check against these first.

1. **Never trust self-reported sensitivity.** Higher tiers always re-classify independently.
2. **Emergency is not a bypass.** Emergency mode has stricter audit requirements than normal mode, not fewer.
3. **No policy sync = no approval.** Policy version mismatch results in rejection, not degraded-mode acceptance.
4. **Execution must be provable.** A change that cannot be confirmed by the NIB is treated as if it did not happen — even if it actually did.
5. **The NIB is the source of truth.** Always.
6. **Audit is mandatory, not optional.** Every decision generates a signed audit entry. There is no silent path.
7. **Rollback payload is required at proposal time.** Not after failure.
8. **New controllers earn trust — they do not assume it.** No controller participates without completing the validation flow.

---

## Research grounding

PDSNO's goals and architecture are grounded in published SDN research. Key influences:

**Koponen et al. — Onix (OSDI 2010)** — foundational NIB design, two-tier data classification (transient vs durable), application-controlled conflict resolution.

**Alsheikh et al. — Distributed SDN Management (ARO 2024)** — adaptive consistency model recommendation (neither static eventual nor static strong consistency is optimal across all operation types), pub/sub over polling for state updates, explicit hierarchy-vs-performance tradeoff analysis.

**ONF TR-521 SDN Architecture** — standardised interface naming (NBI/SBI/East-West), feedback-loop controller model, coexistence with non-SDN infrastructure.

These are documented in detail in the [Design decisions](../design-decisions/index.md) section.