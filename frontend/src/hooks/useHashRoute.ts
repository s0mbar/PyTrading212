import { useCallback, useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash(): string {
  return window.location.hash.replace(/^#\/?/, "");
}

/**
 * Current section kept in the URL (#/bot): the phone's back button and a
 * reload land on the same screen.
 */
export function useHashRoute<T extends string>(routes: readonly T[], fallback: T): [T, (route: T) => void] {
  const hash = useSyncExternalStore(subscribe, readHash, () => "");
  const current = (routes as readonly string[]).includes(hash) ? (hash as T) : fallback;

  const navigate = useCallback((route: T) => {
    if (readHash() !== route) {
      window.location.hash = `/${route}`;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return [current, navigate];
}
