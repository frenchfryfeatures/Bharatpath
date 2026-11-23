/**
 * One app-wide signal that an application changed (2026-11-23).
 *
 * Every mutation (apply, withdraw, confirm or dispute a hire) publishes the
 * server's response here, and every screen showing application state applies
 * it at once -- including screens still mounted under the one that acted
 * (Home's carousel, the Jobs feed, the assistant). The server response is
 * the source of truth: nothing is published before the request succeeds, so
 * there is no optimistic state to roll back, and each screen still refetches
 * on focus to reconcile anything this missed.
 */
import type { ApplicationResponse } from '@/types/application';

export type ApplicationChange = Pick<ApplicationResponse, 'id' | 'job_id' | 'stage'> &
  Partial<ApplicationResponse>;

type Listener = (change: ApplicationChange) => void;
const listeners = new Set<Listener>();

export function publishApplicationChange(change: ApplicationChange): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(change);
    } catch {
      // One screen failing to update must not stop the others.
    }
  }
}

export function subscribeToApplicationChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
