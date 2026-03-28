# PDSNO Roadmap and Vision (6-12 Months)

This page outlines where PDSNO is expected to go over the next 6 to 12 months so contributors can align effort with project priorities.

## Vision

PDSNO aims to become a practical, vendor-neutral governance layer for multi-vendor enterprise networks, with strong policy control, clear auditability, safe automation defaults, and a contributor-friendly plugin ecosystem.

## Near-term priorities (0-3 months)

- Stabilize the current proof-of-concept architecture and core controller flows.
- Improve documentation consistency across concepts, references, and contribution guides.
- Increase test depth around controller validation, approval policy, and rollback behavior.
- Clean up module boundaries and naming for easier onboarding.
- Define the initial plugin contract for discovery, adapters, and policy extensions.

## Mid-term priorities (3-6 months)

- Introduce vendor adapter abstractions for Cisco, Juniper, and Arista style workflows.
- Expand observability with better structured logs, event tracing, and error surfacing.
- Improve operational workflows for policy rollout and rollback validation.
- Strengthen security controls around key exchange and controller trust lifecycle.
- Release a first plugin SDK and developer guide so users can build and register custom plugins.

## Longer-term priorities (6-12 months)

- Production-ready deployment patterns, including Kubernetes guidance.
- Reference implementation of high-availability controller topology.
- Deeper API and data-model hardening for external integrations.
- Contributor-led refinements to code quality, docs quality, and architecture decisions.
- Curated plugin catalog with validation checks, compatibility policy, and community-maintained examples.

## Plugin ecosystem direction

PDSNO is expected to support user-created plugins as a first-class extension model.

- Plugin types: discovery methods, vendor adapters, policy evaluators, and workflow hooks.
- Required controls: signed plugin packages, versioned interfaces, and sandboxed execution boundaries.
- Contributor experience: templates, testing harnesses, and publishing guidance for external developers.

## Where contributors can help most

- Documentation edits and cross-linking to reduce ambiguity.
- Test design for failure-path behavior and state consistency.
- Refactoring and quality improvements in controller and datastore modules.
- Security review and threat-model alignment with implementation.
- Drafting and reviewing plugin interface definitions, SDK examples, and plugin test suites.

## How this roadmap is managed

- This roadmap is a living document and will be updated as milestones are completed or reprioritized.
- Significant changes should be documented with rationale in the Design Decisions section.
