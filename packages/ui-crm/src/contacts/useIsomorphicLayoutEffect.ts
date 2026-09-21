import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` so context retirement runs before paint and before a stale
 * settlement can reach the new context. Falls back to `useEffect` on the server,
 * where `useLayoutEffect` warns and no effects run at all.
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
