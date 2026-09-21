---
"@tindevelopers/domain-campaigns": minor
---

Add campaign lifecycle management to the campaign service/store (state transitions and scheduling support) and atomic campaign recipient replacement backed by the new schema-crm RPC, replacing client-side delete+insert with a single atomic operation.
