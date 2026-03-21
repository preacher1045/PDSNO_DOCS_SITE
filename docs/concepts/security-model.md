# Security model

This page describes PDSNO's security posture — the trust boundaries, cryptographic assumptions, and design properties that make the system resistant to abuse. It is a summary and navigation layer; the detailed threat scenarios and mitigations are in the [Threat model](../security/threat-model.md).

---

## Zero-trust between controllers

PDSNO operates on a zero-trust model between controllers. No controller is implicitly trusted because it is on the same network. Trust is earned through validation and maintained through cryptographic proof on every message.

```
UNTRUSTED                    TRUST BOUNDARY               TRUSTED
─────────────────────────────────────────────────────────────────
Unvalidated controller  ──[Validation flow]──►  Validated controller
External application    ──[NBI auth]──────────►  Authorised client
Network device          ──[SBI credentials]───►  Managed device
```

A controller that has not completed the six-step validation flow cannot:
- Write to the NIB
- Approve or reject configuration proposals
- Receive policy updates
- Participate in discovery reporting

There is no grace period, no degraded-trust mode, no "trusted subnet" exception.

---

## Trust components by feature

### Controller identity

Every controller has a cryptographically assigned identity issued by a higher-tier controller. Identity is bound to: assigned ID, role, region, public key, issuing controller, and expiry. Identities expire — there is no permanent trust.

- **PoC (Phases 1–5):** HMAC-SHA256 signed JSON certificates, shared secrets
- **Phase 6+:** Ed25519 asymmetric certificates, mutual TLS on REST connections

### Message authentication

Every inter-controller message carries an HMAC-SHA256 signature over the full envelope and payload. Recipients reject unsigned messages unconditionally. There is no opt-out.

Replay attack prevention uses two mechanisms together:
- **Timestamp freshness** — messages older than 5 minutes are rejected
- **Nonce deduplication** — each message carries a unique nonce; seen nonces are tracked and rejected on reuse

### Configuration change governance

No configuration executes without a signed execution token from an approving controller. Tokens are:
- Single-use — consumed before execution begins
- Time-bounded — 10 minutes for LOW/MEDIUM, 5 minutes for HIGH
- Cryptographically bound — to the specific proposal, config hash, device list, approver identity, and expiry

A token captured from one context cannot be used in any other context. A replayed token is rejected on the single-use check.

Sensitivity classification is always performed independently at the approving tier. An LC under attacker control cannot misclassify a destructive change as LOW to bypass regional approval — the RC re-classifies regardless of what the LC suggested.

### NIB integrity

The Event Log is append-only at the database level — a trigger rejects any UPDATE or DELETE operation. All entries are signed by the originating controller. Regional and Global Controllers cross-validate entries against independent NIB state: a discrepancy between what an LC reports and what the NIB independently records triggers an audit flag and potential controller suspension.

### Discovery security

Discovery reports are validated by the RC before entering the regional NIB view. Reports from unrecognised or inactive LCs are rejected. Anomaly thresholds flag unusual discovery patterns (sudden large numbers of new devices, MAC addresses appearing in multiple regions) without taking autonomous action.

---

## Security properties by phase

| Phase | Capability |
|-------|-----------|
| **PoC (1–5)** | HMAC-SHA256 message signing, shared secrets per controller pair, signed JSON certificates, single-use execution tokens, append-only Event Log, DH ephemeral key exchange |
| **Phase 6** | Ed25519 asymmetric signatures, mutual TLS on all REST connections, MQTT over TLS, certificate rotation, key management service integration |
| **Phase 7+** | HSM support for GC signing keys, formal RBAC model, external audit anchor for GC-level log integrity |

---

## What the system does not protect against (v1)

Being explicit about security limitations is more useful than overstating the security posture.

**Compromised Global Controller** — the GC is the root of trust. An attacker with control over it can issue fraudulent certificates, modify global policy, and approve destructive changes. The mitigations for a compromised root of trust (multi-GC consensus, HSM-backed keys, external audit anchors) are deferred to Phase 6+. This is acknowledged and tracked — not ignored.

**Coordinated compromise of LC + RC** — if both a Local Controller and its Regional Controller are simultaneously compromised, the cross-validation checks that each performs on the other's reports fail together. The Global Controller's independent audit aggregation provides a third check, but this is not a complete defence.

**Human operator errors** — PDSNO provides blast radius summaries and structured diffs to reviewers, but cannot prevent a human from approving an unsafe change they do not fully understand.

**Physical security** — PDSNO does not address physical access to controller hosts.

These limitations are documented in the [Threat model](../security/threat-model.md) with their planned mitigations.

---

## Security design rules

These are non-negotiable across all implementations. Any contribution that violates them should be rejected in code review:

1. **Never trust self-reported sensitivity.** Higher tiers always re-classify independently.
2. **Emergency is not a bypass.** Emergency mode has stricter audit requirements, not fewer.
3. **No policy sync = no approval.** Policy version mismatch is a hard rejection, not degraded-mode acceptance.
4. **Execution must be provable.** A change that cannot be confirmed by the NIB is treated as if it did not happen.
5. **The NIB is the source of truth.** A controller's local state that disagrees with the NIB is wrong.
6. **Audit is mandatory.** Every decision generates a signed audit entry. There is no silent path.
7. **Rollback payload is required at proposal time.** Not after failure.
8. **New controllers earn trust.** No controller participates without completing the validation flow.

---

## Threat summary

| Threat | Mitigation | Detail |
|--------|-----------|--------|
| Rogue controller joins network | Six-step validation — challenge/response + bootstrap token + policy checks | [Controller validation](controller-validation.md) |
| Stolen bootstrap token | Token is single-use; challenge-response still required even with valid token | [Controller validation](controller-validation.md) |
| LC spoofs LOW sensitivity for HIGH change | RC independently re-classifies every proposal | [Config approval](config-approval.md) |
| Emergency mode used as bypass | Rate limiting + restricted types + mandatory audit + post-facto acknowledgement | [Config approval](config-approval.md) |
| Execution token replayed | Single-use; consumed before execution; bound to config hash + devices | [Config approval](config-approval.md) |
| Partial execution + network failure | Execution state written to NIB before device is touched; reconciliation on reconnect | [Config approval](config-approval.md) |
| Concurrent conflicting approvals | Approval-time device locking via Controller Sync Table | [Network Information Base](network-information-base.md) |
| Forged audit logs | Signed entries; cross-validated with NIB state; append-only | [Network Information Base](network-information-base.md) |
| Discovery scan injection | RC validates report source; anomaly threshold flags spikes | [Device discovery](device-discovery.md) |
| MAC spoofing across regions | GC MAC collision detection flags cross-region duplicates | [Device discovery](device-discovery.md) |
| Replay attack on validation | Timestamp freshness window + nonce deduplication | [Communication model](communication-model.md) |

Full threat scenarios with detailed mitigations: [Threat model](../security/threat-model.md)

---

## Related pages

- [Controller validation](controller-validation.md) — the trust establishment flow in full
- [Threat model](../security/threat-model.md) — all threat scenarios T1–T10 with mitigations
- [Config approval](config-approval.md) — execution token security
- [Communication model](communication-model.md) — message signing and replay prevention