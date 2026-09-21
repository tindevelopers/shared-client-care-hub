---
"@tindevelopers/schema-crm": minor
---

Add typed schema shapes for the CRM lists and suppression surfaces: contact list definitions, list membership, suppression entries, and the UI-facing table shapes the screens consume. Ships three new migrations — `20260919010000_contact_lists_suppressions.sql` (contact lists + suppression list tables), `20260919012000_contact_membership_suppression_integrity.sql` (membership/suppression integrity constraints), and `20260919013000_atomic_campaign_recipient_replacement.sql` (atomic campaign recipient replacement RPC).
