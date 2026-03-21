# Threat model

This document identifies security threats, failure modes, and abuse scenarios in PDSNO, and describes the design-level mitigations for each. It covers four categories: malicious external actors, compromised controllers operating within the trust hierarchy, operational mistakes by legitimate administrators, and distributed-system failure modes.

---

## Threat assumptions

### What PDSNO assumes can happen

- Any controller at any tier can be compromised
- Network partitions will occur and may last for extended periods
- Administrators will make mistakes in configuration and approval
- Policies may drift temporarily across tiers during update propagation
- Attackers will attempt privilege escalation — claiming higher authority than granted
- Replay attacks will be attempted against the validation and approval flows

### What PDSNO does not assume

- A trusted, always-available internal network
- Perfect uptime for any component including the Global Controller
- Honest behaviour from lower-tier controllers
- That audit logs stored locally by a compromised controller are trustworthy

---

## Scope

**In scope for this document:**
- Threats against the controller validation flow
- Threats against the configuration approval flow
- Threats against the NIB (state store)
- Threats arising from controller compromise at Local and Regional tiers

**Explicitly out of scope for v1:**
- Compromise of the Global Controller itself (see T10)
- Physical security of controller hosts
- Threats against the underlying network devices being orchestrated
- Insider threats from human administrators with legitimate access

Deferring these is a conscious decision based on development phase — not a belief that they are unimportant. Each is tracked with a planned mitigation path.

---

## Threat scenarios

### T1 — Sensitivity category spoofing by Local Controller

**Scenario:** A Local Controller declares a high-risk configuration change as `LOW` sensitivity to bypass Regional or Global Controller approval.

**Impact:** A dangerous config change executes without appropriate oversight.

**Mitigation:** Regional and Global Controllers independently re-classify sensitivity based on their own policy evaluation and NIB data. A Local Controller's suggested sensitivity is treated as advisory input only — never authoritative. If the RC's classification differs from the LC's suggestion by more than one level, an additional audit flag is raised.

**Residual risk:** If both the LC and RC are simultaneously compromised, this mitigation fails. Addressed by T6 and T10.

---

### T2 — Emergency mode abuse

**Scenario:** A controller repeatedly invokes emergency mode to bypass the normal approval flow.

**Impact:** Unapproved configuration changes accumulate; the audit trail becomes noisy; operators stop paying attention to emergency alerts.

**Mitigation:**
- Rate-limited per controller (default: 3 emergency invocations per hour, configurable via policy)
- Restricted to specific config types (quarantine, rate-limit, null-route only)
- Restricted to specific device roles (edge devices only by default)
- Every emergency invocation triggers an immediate non-dismissible notification to RC and GC
- Repeated invocations without corresponding post-facto approvals trigger automatic controller suspension

---

### T3 — Policy version drift exploitation

**Scenario:** A Local Controller submits a config request using an outdated policy version, hoping a change that would be blocked under the current policy slips through under the old one.

**Impact:** A change is evaluated against stale rules and incorrectly approved.

**Mitigation:** Policy version is a required field in every config proposal. Regional Controllers reject any proposal whose `policy_version` does not match the current active version. The rejection response includes the current version, enabling the LC to update and retry legitimately — or revealing the mismatch to an observer if the intent was malicious.

---

### T4 — Execution token replay

**Scenario:** A valid execution token is captured and reused to apply a configuration a second time, or to apply it to a different device.

**Impact:** Unauthorised configuration changes executed under a legitimate-appearing token.

**Mitigation:** Tokens are single-use. The token is consumed (marked used) before execution begins. Any second use of the same token is rejected with `TOKEN_ALREADY_USED` and flagged as a security event. Tokens are also cryptographically bound to the specific proposal ID, config hash, device list, approving controller, and expiry — a token captured from one context produces a verification failure in any other context.

---

### T5 — Partial execution with communication failure

**Scenario:** A Local Controller applies a configuration to a device but fails to report the result upstream. The system state is now inconsistent: the device has been reconfigured but the NIB still shows the old state.

**Impact:** Subsequent approval decisions are made based on incorrect state. Rollback decisions may be triggered incorrectly.

**Mitigation:**
- The LC writes `EXECUTING` to the Config Table **before** touching any device
- If the upstream report fails, the LC retries with exponential backoff
- The RC initiates reconciliation if it does not receive an execution report within the expected window
- No assumption-based state transitions are permitted — the system waits for confirmation or escalates

---

### T6 — Concurrent config conflicts

**Scenario:** Two approved configuration changes targeting the same device are executed concurrently. The second change overwrites the first in an unintended way.

**Impact:** The device ends up in a state that neither approval intended. Rollback becomes complicated because neither change knows about the other.

**Mitigation:** The Controller Sync Table implements per-device CONFIG_LOCK at approval time. A device lock is acquired when an approval is granted and held until execution is confirmed. A second request targeting the same locked device receives `DENY_CONFLICT` and is queued or rejected based on policy. Lock TTL (default: 15 minutes) prevents stale locks from blocking forever.

---

### T7 — Rollback failure

**Scenario:** A configuration change fails during execution, and the rollback of that change also fails. The device is left in an indeterminate state.

**Impact:** Network disruption continues with no automated recovery path.

**Mitigation:**
- A failed rollback transitions the device to `DEGRADED` state in the NIB
- All further automated configuration changes for that device are blocked
- An escalation is raised to RC and GC for manual intervention
- The device remains `DEGRADED` until an operator explicitly reviews and resolves the state

`DEGRADED` is an intentional forcing function. It is better to block automation than to keep applying changes to a device in an unknown state.

---

### T8 — Forged audit logs

**Scenario:** A compromised Local Controller falsifies its execution reports or Event Log entries to conceal unauthorised actions.

**Impact:** Malicious or erroneous changes go undetected. Forensic reconstruction of an incident becomes unreliable.

**Mitigation:**
- Audit entries are signed by the originating controller
- RC and GC cross-validate entries against independent NIB state — device discovery records, Config Table state, lock table history
- A discrepancy between what an LC reports and what the NIB independently records triggers an audit flag and potential controller suspension
- The Event Log is append-only at the database level — a trigger rejects UPDATE and DELETE operations

**Limitation:** This mitigation assumes the Regional Controller is not also compromised. If both LC and RC are simultaneously compromised, log integrity at those tiers cannot be guaranteed. The GC's independent audit aggregation provides a third check, but coordinated compromise is not fully mitigated in v1.

---

### T9 — Human approval errors

**Scenario:** An administrator approves a configuration change that is unsafe, without fully understanding its impact.

**Impact:** Damage caused by a change that passed all automated checks but was harmful.

**Mitigation:**
- Every approval request presented to a human reviewer includes: a computed blast radius, a count and criticality of affected devices, a structured config diff, an estimated downtime field, and a maintenance window flag
- Changes above a defined blast radius threshold require an explicit confirmation step
- Audit logs record which human approved and when — supporting accountability and post-incident review

**Residual risk:** Human judgment errors cannot be fully automated away. The mitigations reduce their likelihood and improve accountability after the fact.

---

### T10 — Compromised Global Controller *(acknowledged — deferred to Phase 6+)*

**Scenario:** The Global Controller (`global_cntl_1`) is compromised. An attacker with control over it can issue fraudulent certificates, modify global policy, approve destructive configuration changes, and corrupt the global audit trail.

**Impact:** Complete compromise of the PDSNO trust hierarchy.

**Why this is out of scope for v1:** The mitigations for a compromised root of trust — hardware attestation, distributed consensus among multiple GCs, external audit anchors, formal key ceremony procedures — add significant complexity that is not appropriate for the proof-of-concept phase. Including them now would delay validation of the core orchestration logic without improving it.

**Planned mitigations for Phase 6+:**
- **Multi-GC consensus** — require agreement from 2-of-3 Global Controllers for critical operations
- **Hardware Security Module (HSM)** — store the GC's private key in tamper-resistant hardware
- **External audit anchor** — publish audit log hashes to an independently controlled system so GC-level tampering is detectable
- **Formal STRIDE threat model** — apply structured threat modelling when the system approaches production readiness

This threat is documented here explicitly so it is not forgotten and so readers have accurate expectations about v1 security guarantees.

---

## Security design rules

These rules are non-negotiable. Any implementation that violates them should be rejected:

1. **Never trust self-reported sensitivity.** Higher tiers always re-classify independently.
2. **Emergency is not a bypass.** Emergency mode has stricter audit requirements, not fewer.
3. **No policy sync = no approval.** Policy version mismatch results in rejection, not degraded-mode acceptance.
4. **Execution must be provable.** A change unconfirmed by the NIB is treated as if it did not happen.
5. **The NIB is the source of truth.** Controller local state that disagrees with the NIB is wrong.
6. **Audit is mandatory.** Every decision generates a signed audit entry. There is no silent path.

---

## Residual risks (accepted for now)

| Risk | Current status |
|------|---------------|
| Coordinated compromise of LC + RC | Partially mitigated by GC-level audit aggregation |
| Global Controller compromise | Deferred to Phase 6+ (see T10) |
| Human operator approval errors | Partially mitigated by blast-radius UI; full mitigation requires approval workflow implementation |
| Delayed reconciliation during long network partitions | Current design accepts eventual consistency during partitions with reconciliation on reconnect |

These risks are logged and monitored — not ignored. Each has a tracked mitigation path.

---

## Future enhancements

- Formal STRIDE threat modelling before production deployment
- Cryptographic log chaining (Merkle tree structure) for stronger audit tamper-evidence
- Behavioural anomaly detection on controller activity patterns
- Zero-trust controller identity with certificate pinning
- Multi-GC consensus for critical operations (T10 mitigation)

---

## Related pages

- [Security model](../concepts/security-model.md) — trust boundaries and cryptographic assumptions summary
- [Controller validation](../concepts/controller-validation.md) — mitigations for T1, T3 at the identity layer
- [Config approval](../concepts/config-approval.md) — mitigations for T1, T2, T4, T5, T6, T7
- [Network Information Base](../concepts/network-information-base.md) — mitigations for T6, T8
- [Communication model](../concepts/communication-model.md) — replay attack prevention