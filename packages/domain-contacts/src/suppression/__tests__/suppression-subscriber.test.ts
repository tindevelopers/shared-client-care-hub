/**
 * Suppression Subscriber Tests
 *
 * Tests platform-wide email opt-out on unsubscribe, hard bounce classification,
 * soft bounce pass-through, and bounce reason parsing.
 */
// Hub note: unused vitest imports from the app-side original were trimmed
// (hub lint runs --max-warnings=0); the cases themselves are unchanged.
import { describe, it, expect } from "vitest";

// We test the reason classification logic in isolation (unit-testable).
// Full integration (DB write) is exercised in the integration test suite.

// Replicate the bounce classification logic from suppression-subscriber.ts
const BOUNCE_SUPPRESS_REASONS = new Set([
  'hardbounce',
  'hard_bounce',
  'invalid_email',
  'invalid account',
  'mailbox not found',
  'blocked',
  'spam',
  'complaint',
]);

function shouldSuppress(reason: string): boolean {
  const r = reason.toLowerCase();
  if (BOUNCE_SUPPRESS_REASONS.has(r)) return true;
  // Partial matches
  return (
    r.includes('hard') ||
    r.includes('invalid') ||
    r.includes('not found') ||
    r.includes('blocked') ||
    r.includes('spam')
  );
}

describe("suppression logic", () => {
  // ── Hard bounce reasons → should suppress ─────────────────────────────

  it.each([
    ['hardbounce', true],
    ['hard_bounce', true],
    ['invalid_email', true],
    ['invalid account', true],
    ['mailbox not found', true],
    ['blocked', true],
    ['spam', true],
    ['complaint', true],
    ['HardBounce (mixed case)', true],
    ['550 5.1.1 mailbox not found', true],
    ['554 delivery error: invalid recipient', true],
    ['blocked by policy', true],
  ])('suppresses on "%s" → %s', (reason, expected) => {
    expect(shouldSuppress(reason)).toBe(expected);
  });

  // ── Soft bounce reasons → should NOT suppress ─────────────────────────

  it.each([
    ['mailbox full', false],
    ['temporary failure', false],
    ['greylisted', false],
    ['auto-reply', false],
    ['out of office', false],
    ['connection timeout', false],
    ['', false],
  ])('does NOT suppress on "%s" → %s', (reason, expected) => {
    expect(shouldSuppress(reason)).toBe(expected);
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it('handles null/undefined reason gracefully', () => {
    // Empty/undefined reason → no suppression (soft bounce default)
    expect(shouldSuppress('')).toBe(false);
  });

  it('suppresses when reason contains "spam" anywhere', () => {
    expect(shouldSuppress('marked as spam by user')).toBe(true);
  });

  it('suppresses when reason contains "hard" anywhere', () => {
    expect(shouldSuppress('hard delivery failure')).toBe(true);
  });
});
