# Implementation Checklist — CSM Role Upgrade

- [ ] Inventory every route and action.
- [ ] Map each to resource/action/scope/state/fields.
- [ ] Add granular permission keys and seed them.
- [ ] Replace direct role gates with central authorization policy.
- [ ] Enforce record scope on reads, writes, search, export, attachments, links, audit and AI.
- [ ] Add workflow transition guards.
- [ ] Add protected-field guards.
- [ ] Add maker-checker and self-approval denial.
- [ ] Add Service Owner lifecycle, commitment, risk and delegation controls.
- [ ] Make UI actions derive from the same permissions.
- [ ] Add allow and deny audit evidence.
- [ ] Implement all positive and negative tests from the four role specifications.
- [ ] Confirm no cross-customer, cross-team or cross-service leakage.
