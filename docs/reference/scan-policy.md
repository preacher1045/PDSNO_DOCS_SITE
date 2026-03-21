# Scan policy

The scan policy is the primary operational input that governs what a Local Controller is permitted to discover. It is distributed to LCs via the [policy propagation](../concepts/policy-propagation.md) flow — LCs do not set their own scan scope.

This page is the full schema reference for `scan_policy.yaml`.

---

## Overview

A scan policy is assigned to a Local Controller by its Regional Controller after validation. It defines:

- Which networks the LC is permitted to scan
- Which scan protocols are allowed
- When scanning is permitted (schedule window)
- Resource limits (threads, concurrent probes, timeouts)
- Safety constraints (packet rate limits, device blacklist)

A Local Controller that receives no approved networks in its active policy skips discovery entirely and writes `DISCOVERY_SKIPPED` to the Event Log. It does not scan anything not explicitly listed.

---

## Full schema reference

```yaml
policy_id: "region1-west-scan-v1"   # Assigned by Regional or Global Controller
version: 1.0

applies_to:
  controller_tier: "local"
  region: "auto"                     # auto-detected by regional controller

# ─────────────────────────────────────────────────
# NETWORK SCOPE — where the LC is permitted to scan
# ─────────────────────────────────────────────────

allowed_networks:
  static:                            # Explicitly approved networks
    - interface: "eth0"
      cidr: "10.10.20.0/24"
      vrf: "default"
      vlan: null
    - interface: "eth1"
      cidr: "192.168.50.0/25"
      vrf: "mgmt"
      vlan: 100

  dynamic:                           # Networks pushed by RC after validation
    allow_dynamic_assignment: true
    constraints:
      max_dynamic_ranges: 3
      require_signed_assignment: true

# ─────────────────────────────────────────────────
# PROTOCOLS — what scanning methods are permitted
# ─────────────────────────────────────────────────

allowed_protocols:
  - "arp"
  - "icmp"
  - "snmpv2c"
  - "snmpv3"
  - "lldp"

prohibited_protocols:
  - "telnet"
  - "ftp"
  - "tftp"
  - "ssh"                            # SSH allowed for config only, not scanning

# ─────────────────────────────────────────────────
# SCAN MODE
# ─────────────────────────────────────────────────

scan_mode:
  default: "incremental"             # incremental | full
  allowed_modes:
    - "incremental"                  # Scan only changed/new devices
    - "full"                         # Scan all devices in subnet

# ─────────────────────────────────────────────────
# SCHEDULE — when scanning is permitted
# ─────────────────────────────────────────────────

schedule:
  window_start: "00:00"             # UTC
  window_end: "06:00"               # UTC
  max_scans_per_hour: 4

# ─────────────────────────────────────────────────
# RESOURCE LIMITS
# ─────────────────────────────────────────────────

resource_limits:
  max_threads: 20
  max_concurrent_probes: 100
  probe_timeout_seconds: 2
  max_protocols_parallel: 3

# ─────────────────────────────────────────────────
# SAFETY CONSTRAINTS
# ─────────────────────────────────────────────────

safety:
  max_packet_rate_per_device: 200   # Packets per second per target
  respect_device_blacklist: true    # Skip devices in the NIB blacklist
  treat_unknown_devices_as: "suspicious"  # suspicious | neutral | trusted

# ─────────────────────────────────────────────────
# DELEGATION — what RC can override
# ─────────────────────────────────────────────────

delegation:
  allow_regional_override: true
  regional_constraints:
    max_threads: 10
    allowed_protocols:
      - arp
      - icmp

# ─────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────

logging:
  batch_size: 200
  compress_before_send: true
  sign_logs: true
  retention_days_local: 7
  retention_days_regional: 30

# ─────────────────────────────────────────────────
# APPROVAL
# ─────────────────────────────────────────────────

approval:
  requires_config_push_approval: true
  config_approval_route: "regional"  # regional | global
```

---

## Field reference

### `allowed_networks.static`

Explicitly approved subnets. The LC scans only these CIDRs.

| Field | Required | Description |
|-------|----------|-------------|
| `interface` | Yes | Network interface to use for scanning (e.g. `eth0`) |
| `cidr` | Yes | Subnet in CIDR notation |
| `vrf` | No | VRF name if the subnet is in a non-default routing table |
| `vlan` | No | VLAN tag if required for scan packets |

### `allowed_networks.dynamic`

When `allow_dynamic_assignment: true`, the RC can push additional subnets to the LC after validation without requiring a full policy update. This is useful for on-demand discovery of newly provisioned subnets.

`require_signed_assignment: true` means dynamically pushed subnets must be signed by the RC — the LC validates the signature before adding the subnet to its scan targets.

`max_dynamic_ranges` limits the total number of dynamically assigned subnets to prevent an RC from overloading a single LC.

### `allowed_protocols`

| Protocol | Purpose | Notes |
|----------|---------|-------|
| `arp` | Device detection, MAC-IP mapping | Required for primary discovery |
| `icmp` | Reachability verification, RTT measurement | Standard ping |
| `snmpv2c` | Device enrichment (vendor, hostname, interfaces) | Community string required |
| `snmpv3` | SNMP with authentication and encryption | Preferred over v2c in production |
| `lldp` | Link Layer Discovery Protocol topology | Requires managed switch support |

### `scan_mode`

`incremental` — the LC tracks which devices it has seen before and prioritises rescanning devices that may have changed (IP address change, status change). New devices in the subnet are still discovered.

`full` — the LC scans every IP in the permitted CIDRs regardless of previous results. Slower but ensures no stale records. Typically used for the bootstrap scan on first deployment.

### `schedule`

All times are UTC. The LC respects the scan window — it will not initiate a new scan cycle outside the window. If a scheduled cycle would start outside the window, it is deferred to the next window.

`max_scans_per_hour` provides an additional rate limit independent of the schedule window.

### `resource_limits`

| Field | Default | Effect of too-high value |
|-------|---------|--------------------------|
| `max_threads` | 20 | Excessive CPU and memory on LC host |
| `max_concurrent_probes` | 100 | Network congestion on scanned subnet |
| `probe_timeout_seconds` | 2 | Slow discovery cycles if raised; missed devices if lowered |
| `max_protocols_parallel` | 3 | No practical upper limit — all three default protocols fit |

### `safety`

`max_packet_rate_per_device` — the LC throttles scan traffic to this rate per target device. This prevents the LC from triggering rate-limit responses or IDS alerts on scanned devices.

`respect_device_blacklist` — when `true`, the LC skips any device listed in the NIB blacklist during scans. The blacklist is maintained in the NIB and distributed via policy.

`treat_unknown_devices_as` — determines the initial status assigned to newly discovered devices before they are reviewed by a human or policy engine. `suspicious` blocks automated config changes to new devices until they are explicitly cleared. `neutral` allows automated changes immediately. `trusted` is not recommended for production.

### `delegation.regional_constraints`

When the RC overrides scan parameters (via `allow_regional_override: true`), it cannot exceed the constraints defined here. The RC can restrict the LC further, but cannot grant it more threads or protocols than the policy allows. This prevents an RC from unilaterally expanding a Local Controller's scan scope beyond what policy permits.

---

## Applying a policy change

Policy changes are distributed via MQTT — they do not require restarting the Local Controller. When the LC receives a new policy version:

1. It validates the policy signature
2. It writes the new policy to its local NIB Policy Table
3. It applies the new policy on the next discovery cycle

In-progress scans are not interrupted by a policy update — the new policy takes effect at the start of the next cycle.

---

## Related pages

- [Policy propagation](../concepts/policy-propagation.md) — how scan policies are distributed to LCs
- [Device discovery](../concepts/device-discovery.md) — how LCs use scan policy during a discovery cycle
- [Deployment guide](deployment-guide.md) — where policy files live in the repo
