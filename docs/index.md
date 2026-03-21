# PDSNO — Partially Distributed Software-Defined Network Orchestrator

**PDSNO** is an open-source, enterprise-grade network orchestration framework that governs configuration changes, enforces policy, and maintains a unified audit trail across multi-vendor network infrastructure.

It sits *above* your existing tools — Cisco ACI, VMware NSX, Juniper Apstra — as a coordination and governance layer, giving you control and visibility across your entire network, not just the parts your vendor covers.



## Why PDSNO exists

Enterprise networks are multi-vendor by necessity. But every vendor's orchestration tool manages its own domain well and ignores everything outside it. The result: multiple dashboards, multiple policy systems, multiple audit trails — and no single place to govern the whole network.

PDSNO closes that gap.



## How it works at a glance

PDSNO uses a **three-tier controller hierarchy** that distributes execution while keeping governance centralised:

```
Global Controller        — root of trust, policy authority, high-risk approvals
    └── Regional Controller  — zone governance, most operational approvals
            └── Local Controller    — direct device interaction, discovery, execution
```

Every configuration change is **proposed, classified, approved, token-issued, and executed** through this hierarchy. Every decision is signed and written to an immutable audit log. Nothing happens silently.



## Key capabilities

<div class="grid cards" markdown>

-   **Multi-vendor governance**

    ---

    A vendor-agnostic adapter layer translates generic configuration intents into vendor-specific commands. One approval flow governs Cisco, Juniper, Arista, and anything that speaks NETCONF.

-   **Policy-driven config approval**

    ---

    Every change is classified LOW / MEDIUM / HIGH / EMERGENCY. Each tier has its own approval path, execution tokens, and rollback payload — required at proposal time, not after failure.

-   **Cryptographic controller validation**

    ---

    No controller joins the network without passing a six-step challenge-response validation flow. Trust is earned through cryptography, not assumed from network position.

-   **Unified audit trail**

    ---

    Every proposal, approval, execution, and rollback is signed and written to the Network Information Base Event Log. Append-only, tamper-evident, queryable.

-   **Device discovery**

    ---

    Local Controllers scan assigned subnets using ARP, ICMP, and SNMP in parallel. Results are delta-reported upward, deduplicated by MAC address, and anomaly-checked at each tier.

-   **Immutable state in the NIB**

    ---

    The Network Information Base is the single source of truth for all device state, configuration history, policy, and audit records. Controllers are stateless with respect to network knowledge.

</div>



## Current status

PDSNO is an active open-source project in its proof-of-concept phase. The core architecture, validation flow, discovery engine, and config approval logic are fully designed and documented. Python implementation is underway.

| Component | Status |
|-----------|--------|
| Architecture & design | ✅ Complete |
| Controller validation | ✅ Implemented |
| Device discovery (ARP / ICMP / SNMP) | ✅ Implemented |
| Config approval logic | ✅ Implemented |
| REST communication layer | ✅ Implemented |
| MQTT pub/sub layer | ✅ Implemented |
| Message authentication (HMAC) | ✅ Implemented |
| Key distribution (DH ephemeral) | ✅ Implemented |
| Vendor adapter layer | ⏳ Planned — Phase 7 |
| Kubernetes deployment | ⏳ Planned — Phase 6+ |



## Where to start

**New to PDSNO?** Start with [What is PDSNO](getting-started/what-is-pdsno.md) for the full problem statement and positioning, then read [How it works](getting-started/how-it-works.md) for the architectural overview.

**Ready to run it?** Go to [Quick start](getting-started/quick-start.md).

**Want to contribute?** Read [How to contribute](contributing/how-to-contribute.md) and [Repository structure](reference/repository-structure.md).

**Evaluating PDSNO against existing tools?** See the [Vendor gap analysis](vendor-analysis/gap-analysis.md).



!!! note "Documentation note"
    This site documents the design and architecture of PDSNO. Implementation details, code references, and operational runbooks live in the [project repository](https://github.com/your-org/pdsno). When in doubt, the repository is the source of truth for current implementation state.