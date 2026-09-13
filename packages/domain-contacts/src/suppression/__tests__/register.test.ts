/**
 * Suppression subscriber registration smoke tests (VAL-CONTACTS-012).
 *
 * Proves the moved subscriber registers its two event handlers on the
 * core-kernel event bus from the package, with the injected service-role
 * client, and unregisters cleanly — no app code involved.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { eventBus } from "@tindevelopers/core-kernel/events";
import {
  registerSuppressionSubscribers,
  unregisterSuppressionSubscribers,
} from "../suppression-subscriber.js";

const subscribeSpy = vi.spyOn(eventBus, "subscribe");

beforeEach(() => {
  unregisterSuppressionSubscribers();
  subscribeSpy.mockClear();
});

describe("suppression subscriber registration", () => {
  test("registers contact.unsubscribed and message.bounced handlers with the injected client", () => {
    registerSuppressionSubscribers({ client: { from: vi.fn() } as never });

    expect(subscribeSpy).toHaveBeenCalledTimes(2);
    expect(subscribeSpy).toHaveBeenCalledWith(
      "contact.unsubscribed",
      "suppression-unsubscribe",
      expect.any(Function),
    );
    expect(subscribeSpy).toHaveBeenCalledWith(
      "message.bounced",
      "suppression-bounce",
      expect.any(Function),
    );
  });

  test("double registration is a no-op and unregister clears both", () => {
    registerSuppressionSubscribers({ client: { from: vi.fn() } as never });
    registerSuppressionSubscribers({ client: { from: vi.fn() } as never });
    expect(subscribeSpy).toHaveBeenCalledTimes(2);

    unregisterSuppressionSubscribers();
    // Re-registering after unregister works again (fresh subscriptions).
    registerSuppressionSubscribers({ client: { from: vi.fn() } as never });
    expect(subscribeSpy).toHaveBeenCalledTimes(4);
    unregisterSuppressionSubscribers();
  });
});
