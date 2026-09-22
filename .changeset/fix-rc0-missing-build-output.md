---
"@tindevelopers/schema-crm": patch
"@tindevelopers/domain-contacts": patch
"@tindevelopers/domain-campaigns": patch
"@tindevelopers/ui-crm": patch
---

Republish RC build. The `-rc.0` tarballs were published from a fresh checkout without running `pnpm build` first, so they shipped without compiled `dist/` output and are unusable. No source changes; this cuts a new RC build with `dist/` included.
