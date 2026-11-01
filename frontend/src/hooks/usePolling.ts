import { useEffect, useRef } from "react";

/**
 * Calls `task` now, then every `intervalMs` while `enabled`.
 * Paused while the page is hidden (phone locked, app in background): no
 * wasted Trading 212 calls, and an immediate refresh when it comes back.
 */
export function usePolling(task: () => Promise<unknown> | void, intervalMs: number, enabled = true): void {
  const taskRef = useRef(task);

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let timer: number | undefined;

    const tick = () => {
      void taskRef.current();
    };
    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(tick, intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden) {
        window.clearInterval(timer);
      } else {
        tick();
        start();
      }
    };

    tick();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
