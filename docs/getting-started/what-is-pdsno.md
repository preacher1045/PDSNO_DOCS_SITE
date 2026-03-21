# What is PDSNO

## The problem it solves

Enterprise networks are built from multiple vendors. A typical organisation runs Cisco ACI in its data centre, VMware NSX for virtualisation, Juniper at its branches, and one or more cloud providers on top. Each vendor's orchestration tool manages its own domain well. None of them manage the rest.

The consequence is structural, not a matter of product quality:

- Network engineers operate **multiple dashboards** with no unified view
- **Policy is defined separately** in each system, in each vendor's syntax, with no consistency check between them
- **Audit trails are fragmented** — reconstructing what changed, when, and who approved it requires manually correlating logs from multiple systems
- **Change governance spans tools** but no single tool owns the full change lifecycle

For organisations subject to PCI-DSS, SOX, HIPAA, or NIS2, this is not just an operational headache. It is a compliance liability.

---

## What PDSNO is

PDSNO is a **hierarchical network orchestration framework** that sits above your existing vendor tools as a coordination and governance layer.

It does not replace Cisco ACI or VMware NSX. It augments them — pulling state from each vendor's API into a unified data store, enforcing consistent policy across all of them, and providing a single audit trail that none of them deliver alone.

The value proposition in one sentence: **PDSNO gives you control and visibility across your entire network, not just the parts your vendor covers.**

---

## What "partially distributed" means

The name is deliberate and worth understanding upfront.

PDSNO is not a fully centralised system — that would be a single point of failure and a performance bottleneck. But it is also not a flat peer-to-peer system — that would sacrifice the governance properties that make it useful for enterprise environments.

What is **distributed** in PDSNO is *execution* and *local decision-making*:

- Local Controllers discover devices and execute approved configurations without waiting for global sign-off on every operation
- Regional Controllers govern their zones and approve most operational changes autonomously
- The system continues operating for LOW and MEDIUM changes even when connectivity to higher tiers is degraded

What is **centralised** in PDSNO is *governance*:

- Policy authority flows downward from the Global Controller
- High-sensitivity changes require a verifiable chain of approval
- Every controller's identity is cryptographically rooted at the Global Controller
- The audit trail is unified and tamper-evident

This tradeoff is a **conscious design decision**, not an oversight. Environments where governance and auditability matter more than raw performance are exactly what PDSNO is designed for. Environments where performance is the primary concern and governance is secondary would be better served by a flatter architecture.

---

## Architectural grounding

PDSNO's design is grounded in established SDN research and industry standards:

**ONF SDN Architecture (TR-521)** — PDSNO follows the Open Networking Foundation's SDN architecture principles, including standardised interface naming (NBI, SBI, East/West interfaces) and the principle of coexistence with non-SDN infrastructure.

**Onix NIB design** — The Network Information Base concept in PDSNO is independently aligned with Onix (Koponen et al., OSDI 2010), the distributed SDN controller developed at Nicira that became the foundation for VMware NSX. The core insight — that control applications should read and write to a shared data structure rather than communicate directly — is the same in both systems.

**Self-Organizing Network principles** — PDSNO's algorithm framework maps to the three SON principles: Self-Configuration (device discovery), Self-Optimization (congestion mitigation, policy adaptation), and Self-Healing (rollback, fault recovery).

---

## Who it is for

PDSNO is built for network engineers and architects at organisations that:

- Run infrastructure from more than one vendor and feel the friction of managing governance across all of them
- Need to produce unified change audit records for compliance purposes and currently cannot
- Want to enforce consistent security policy across vendor domains and have no tool that does this today
- Are evaluating open-source alternatives to proprietary multi-vendor management tools like Juniper Apstra

It is **not** the right tool for organisations with single-vendor infrastructure, or for environments where the existing vendor's orchestration layer already covers all managed devices.

---

## How it compares to existing tools

| Tool | What it does well | Where PDSNO adds value |
|------|------------------|----------------------|
| Cisco ACI / APIC | Policy automation within Cisco fabric | Multi-vendor coordination, cross-domain audit |
| VMware NSX | Network virtualisation within VMware stack | Cross-domain governance, unified compliance reporting |
| Juniper Apstra | Intent-based networking, multi-vendor support | Strongest overlap — see [gap analysis](../vendor-analysis/gap-analysis.md) |
| HashiCorp Terraform | Infrastructure-as-code, cross-vendor provisioning | Different layer — Terraform provisions, PDSNO governs |
| Red Hat Ansible | Automation and configuration management | Different layer — Ansible executes, PDSNO governs and audits |

The most important comparison is with **Juniper Apstra**. Apstra is the closest existing product to what PDSNO is building and was acquired by Juniper precisely because it solved the multi-vendor management problem. Key differences: Apstra is now owned by Juniper (creating commercial incentive to favour Juniper hardware over time), carries enterprise pricing, and has less developed governance and change approval capabilities than PDSNO's designed architecture.

---

## What PDSNO is not

**Not a network monitoring tool.** PDSNO does not collect telemetry or generate alerts. It governs changes and maintains state — it does not watch traffic.

**Not a provisioning tool.** PDSNO does not bootstrap new devices from scratch. Devices are discovered after they are physically connected and reachable.

**Not a replacement for vendor UIs.** PDSNO centralises governance tasks — change approval, policy distribution, audit logging. Engineers still use vendor-native interfaces for complex vendor-specific configuration.

**Not production-ready yet.** PDSNO is an active proof-of-concept. The architecture is fully designed and documented. Core implementation is underway. The vendor adapter layer that connects PDSNO to existing infrastructure is planned for Phase 7.

---

## Next steps

- [How it works](how-it-works.md) — the architecture overview
- [Quick start](quick-start.md) — run PDSNO locally
- [Vendor gap analysis](../vendor-analysis/gap-analysis.md) — detailed competitive positioning