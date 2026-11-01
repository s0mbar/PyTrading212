// Global count of in-flight API requests, drives the top progress bar.
// Background polling passes `silent` so the bar only reflects user actions.

type Listener = () => void;

let inFlight = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function beginRequest(): void {
  inFlight += 1;
  emit();
}

export function endRequest(): void {
  inFlight = Math.max(0, inFlight - 1);
  emit();
}

export function subscribeLoading(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInFlight(): number {
  return inFlight;
}
