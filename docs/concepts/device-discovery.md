# Device discovery

Device discovery is how PDSNO learns what exists in the network. Every device record in the NIB was put there by a discovery cycle. Without discovery, there is nothing to govern.

---

## Roles in discovery

| Controller | Responsibility |
|-----------|---------------|
| **Local Controller** | Runs the actual network scans. Owns raw scan results. Consolidates multi-protocol data per device. Writes to the local NIB view. Reports to RC. |
| **Regional Controller** | Receives discovery reports from all LCs in its zone. Validates, deduplicates across LCs. Writes to the regional NIB view. Detects cross-LC anomalies. Reports summary to GC. |
| **Global Controller** | Receives regional summaries. Runs global deduplication. Produces network-wide device inventory. Detects cross-region anomalies. |

---

## Discovery triggers

Discovery does not only run on a schedule. Four triggers exist:

| Trigger | Initiator | When |
|---------|-----------|------|
| **Scheduled** | LC scheduler | Every `policy.discovery_interval` seconds (default: 300s) |
| **On-demand** | RC or GC sends `DISCOVERY_REQUEST` | After a config change, after an incident, when a new region comes online |
| **Event-driven** | LC detects a link-state change via SBI | When the network signals something changed |
| **Bootstrap** | GC triggers once at system startup | Initial population of the NIB on first deployment |

The flow is identical regardless of which trigger fires — only the initiating event differs.

---

## Scan protocols

Each Local Controller runs three scan protocols in parallel against its assigned subnet:

### ARP scan

Sends ARP requests to all IPs in the subnet and collects responses. Returns `{ip_address, mac_address}` pairs. Works only within the local broadcast domain (L2 network). This is the primary discovery mechanism — it runs against every host in the subnet.

### ICMP ping

Confirms reachability of IPs found by ARP and measures round-trip time. Runs concurrently with ARP. Devices that respond to ARP but not ICMP are still recorded — ICMP blocking is common on managed devices.

### SNMP query

Enriches known devices with vendor information, hostname, interface list, and uptime. Runs only against IPs already confirmed reachable by ARP or ICMP — never cold-probed. SNMP failure is non-critical: a device is still recorded from ARP/ICMP data; SNMP enrichment is optional.

```
ARP scan      ──► {ip, mac} pairs
ICMP ping     ──► {ip, reachable, rtt_ms}
SNMP query    ──► {ip, vendor, hostname, interfaces, uptime}
                                │
                                ▼
                    Merge by MAC address
                                │
                                ▼
                    Single DeviceRecord per device
```

---

## The complete discovery cycle

### Stage 1 — Build scan targets

The LC reads its active policy from the NIB to determine which subnets and protocols to scan. The LC does not decide this itself — policy controls what it is permitted to scan.

If no scan targets are found in policy, the cycle is skipped and a `DISCOVERY_SKIPPED` event is written to the Event Log.

### Stage 2 — Run parallel scans

All three protocols run concurrently using async I/O. A single protocol failing (SNMP timeout, ICMP blocked) does not abort the cycle — the LC logs `SCAN_PROTOCOL_FAILED` and continues with available data. A complete scan failure across all protocols writes `DISCOVERY_CYCLE_FAILED` and notifies the RC, but does not change any existing device records.

### Stage 3 — Consolidate per device

Results from all three protocols are merged into a single `DeviceRecord` per MAC address. MAC address is the stable unique key — everything deduplicates on it. If ARP found the device but SNMP timed out, the record is created with available data and `snmp_reachable: false`.

### Stage 4 — Diff against NIB

The consolidated results are compared against what the NIB already knows:

- **NEW** — MAC not in NIB → will be inserted
- **UPDATED** — MAC in NIB, attributes changed (IP, status, hostname) → will be updated
- **UNCHANGED** — MAC in NIB, no changes → no write needed
- **DISAPPEARED** — MAC was in NIB but not seen this cycle → missed cycle counter incremented

Only NEW and UPDATED devices trigger NIB writes. Unchanged devices are skipped — no write means no version increment, no conflict risk.

### Stage 5 — Write to NIB

**New devices** receive an allocated `device_id` (format: `nib-dev-{sequence}`) and are inserted with `version = 0`.

**Updated devices** are written with a version check — the update only commits if the stored version matches the version the LC read. If another controller updated the record since the LC's read, the write returns `CONFLICT` and the LC re-reads and retries.

**Disappeared devices** are not immediately marked inactive. The LC increments a missed cycle counter. Only after `policy.missed_cycles_before_inactive` consecutive missed cycles (default: 3) does the device status change to `inactive`. This prevents a single slow or failed scan from incorrectly removing healthy devices from the NIB.

### Stage 6 — Send delta report to RC

The LC sends only what changed — new, updated, and inactive devices. Unchanged devices are not included. This delta-only approach keeps report sizes manageable as networks grow.

The report includes the `policy_version` the LC was operating under. The RC checks this during validation.

---

## Regional Controller processing

### Stage 7 — Validate the report

The RC checks:
- The reporting LC is registered and active in the NIB
- The `policy_version` in the report matches the RC's current active policy

A stale policy version is flagged but not rejected — the LC may have been slightly behind on policy sync. An unrecognised or inactive LC is rejected outright: `DISCOVERY_REPORT_REJECTED`.

### Stage 8 — Deduplicate across LCs

A device visible to two LCs (sitting at the boundary between two LC zones) generates reports from both. The RC deduplicates using MAC address as the canonical key:

- If the same MAC is reported by two LCs, the record with the more recent `last_seen` timestamp wins
- Both observations are recorded in the Event Log (`DEVICE_MULTI_LC`)
- If the device is now reported by a different LC than the one that originally registered it, the `local_controller` field is updated (`DEVICE_LC_REASSIGNED`)

### Stage 9 — Anomaly detection

The RC runs anomaly checks that individual LCs cannot perform because they only see their own subnet:

**Cross-region device** — the same MAC address appearing in two different regions simultaneously. This should not happen in a well-segmented network. May indicate MAC spoofing, a misconfigured tunnel, or a data error. Flagged as `ANOMALY_CROSS_REGION_DEVICE`.

**Discovery spike** — a single LC reporting an unusually large number of new devices in one cycle. May indicate scan injection or a misconfigured CIDR. Flagged as `ANOMALY_DISCOVERY_SPIKE`.

Anomalies are flagged to the Event Log. The discovery system does not take autonomous action on them — a human or future policy engine decides what to do.

### Stage 10 — Send regional summary to GC

The RC sends an aggregated summary to the GC: total new/updated/inactive devices across all LCs in the zone, list of LCs that reported, list of LCs that did not report, and any flagged anomalies.

---

## Global Controller processing

The GC receives regional summaries and runs global-level checks:

**Global MAC deduplication** — the same MAC appearing in two different regions is a serious anomaly flagged as `ANOMALY_GLOBAL_MAC_COLLISION`. Possible causes: MAC spoofing, misconfigured VXLAN/GRE tunnels, or a data error in regional reporting.

**Missing RC detection** — if an RC's summary does not arrive within the expected window, the GC flags `DISCOVERY_RC_MISSING` and may trigger an on-demand discovery request.

**Global inventory update** — the GC updates its global NIB view with device counts and status per region. This is the network-wide inventory that the NBI exposes to external tools.

---

## Key design decisions

**MAC address as the canonical key.** IP addresses change. Hostnames change. MAC addresses are hardware-bound and stable across reboots, IP reassignments, and VLAN changes. Everything in the discovery system keys on MAC.

**Delta reporting only.** Each LC sends only what changed to its RC — not the full device inventory. This keeps report sizes manageable as subnets grow. An RC receiving a full inventory of 254 devices every 300 seconds from 20 LCs is a bandwidth and processing problem that delta reporting avoids entirely.

**Failed scans do not delete data.** A device not seen in one cycle is not immediately marked inactive. Multiple consecutive missed cycles are required. This prevents transient network noise — a temporary ARP flooding issue, a momentary ICMP rate-limit — from incorrectly removing valid devices from the NIB.

**Anomaly detection is passive.** The discovery system flags anomalies to the Event Log. It does not quarantine devices, block traffic, or take any network action autonomously. The governance layer — config approval — handles remediation.

---

## Scan policy

What a Local Controller is permitted to scan is defined by policy, not by the LC itself. The `scan_policy.yaml` controls:

- Which subnets are approved for scanning
- Which protocols are permitted
- Scan schedule and maximum rate
- Resource limits (max threads, concurrent probes, probe timeout)
- Safety constraints (max packet rate per device, device blacklist)

A Local Controller that receives no scan targets from its active policy skips the discovery cycle entirely and logs `DISCOVERY_SKIPPED`. It does not scan anything not explicitly permitted.

→ See [Scan policy](../reference/scan-policy.md) for the full policy schema and configuration reference.

---

## Event types written during discovery

| Event type | Written by | When |
|------------|-----------|------|
| `DISCOVERY_SKIPPED` | LC | No scan targets in policy |
| `SCAN_PROTOCOL_FAILED` | LC | Single protocol failure |
| `DISCOVERY_CYCLE_FAILED` | LC | All protocols failed |
| `DEVICE_DISCOVERED` | LC | New device written to NIB |
| `DEVICE_UPDATED` | LC | Existing device record updated |
| `DEVICE_INACTIVE` | LC | Device missed required cycles |
| `DISCOVERY_WRITE_CONFLICT` | LC | Optimistic lock conflict during write |
| `DISCOVERY_REPORT_SENT` | LC | Report dispatched to RC |
| `DISCOVERY_REPORT_RECEIVED` | RC | Report accepted |
| `DISCOVERY_REPORT_REJECTED` | RC | Unknown or inactive LC |
| `DISCOVERY_REPORT_STALE_POLICY` | RC | Policy version mismatch (flagged, not rejected) |
| `DEVICE_LC_REASSIGNED` | RC | Device now reported by different LC |
| `DEVICE_MULTI_LC` | RC | Same device seen by multiple LCs |
| `ANOMALY_CROSS_REGION_DEVICE` | RC | Same MAC in two regions |
| `ANOMALY_DISCOVERY_SPIKE` | RC | Unusually large new-device count |
| `REGIONAL_SUMMARY_SENT` | RC | Summary dispatched to GC |
| `ANOMALY_GLOBAL_MAC_COLLISION` | GC | Same MAC in two regions (global check) |
| `LC_DISCOVERY_OVERDUE` | RC | LC has not reported within timeout |

---

## Related pages

- [Network Information Base](network-information-base.md) — Device Table schema and optimistic locking
- [Controller hierarchy](controller-hierarchy.md) — how the discovery hierarchy relates to the governance hierarchy
- [Scan policy](../reference/scan-policy.md) — full policy schema
- [API reference](../reference/api-reference.md) — DISCOVERY_REPORT and DISCOVERY_SUMMARY message schemas