/**
 * Where a notification leads (2026-11-23).
 *
 * The server decides it (`InboxItem.destination`, and `data.destination` on a
 * push) from the template and the event behind the message -- never from the
 * text, which is translated. `routeForDestination` turns that into a route.
 * Messages from an older server carry no destination; `routeForTemplate`
 * keeps them working by their template code alone.
 */
export type DestinationKind =
  | 'APPLICATION'
  | 'APPLICATIONS'
  | 'JOB'
  | 'INTERVIEW_REPORT'
  | 'SUBSCRIPTION'
  | 'PROFILE'
  | 'STREAK'
  | 'INBOX';

export interface NotificationDestination {
  kind: DestinationKind;
  id?: string | null;
}

export type AppRoute = string | { pathname: string; params?: Record<string, string> };

const KINDS: ReadonlySet<string> = new Set<DestinationKind>([
  'APPLICATION', 'APPLICATIONS', 'JOB', 'INTERVIEW_REPORT', 'SUBSCRIPTION', 'PROFILE', 'STREAK', 'INBOX',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a destination from a push payload, which is untrusted input. */
export function parseDestination(value: unknown): NotificationDestination | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  if (typeof kind !== 'string' || !KINDS.has(kind)) return null;
  const safeId = typeof id === 'string' && UUID.test(id) ? id : null;
  return { kind: kind as DestinationKind, id: safeId };
}

export function routeForDestination(destination: NotificationDestination): AppRoute {
  const id = destination.id ?? undefined;
  switch (destination.kind) {
    case 'APPLICATION':
      return id ? { pathname: '/application-detail', params: { id } } : '/board';
    case 'APPLICATIONS':
      return '/board';
    case 'JOB':
      return id ? { pathname: '/job-detail', params: { id } } : '/jobs';
    case 'INTERVIEW_REPORT':
      return id ? { pathname: '/interview-report', params: { sessionId: id } } : '/interview-sessions';
    case 'SUBSCRIPTION':
      return '/subscription';
    case 'PROFILE':
      return '/profile-details';
    case 'STREAK':
      return '/streak';
    case 'INBOX':
    default:
      return '/notifications';
  }
}

/** Fallback for messages written before destinations existed. */
export function routeForTemplate(code: string): AppRoute {
  switch (code) {
    case 'IN_APP_APPLICATION_SENT':
    case 'IN_APP_APPLICATION_UPDATE':
    case 'IN_APP_EMPLOYER_MESSAGE':
    case 'IN_APP_INTERVIEW_INVITATION':
    case 'IN_APP_ASSESSMENT_INVITATION':
    case 'IN_APP_SHORTLIST_INVITED':
      return '/board';
    case 'IN_APP_PAYMENT_RECEIVED':
    case 'IN_APP_PAYMENT_FAILED':
    case 'IN_APP_ACCESS_ENDED':
    case 'IN_APP_PRE_DEBIT':
      return '/subscription';
    case 'IN_APP_INTERVIEW_FEEDBACK_READY':
      return '/interview-sessions';
    case 'IN_APP_PROFILE_INCOMPLETE':
      return '/profile-details';
    case 'IN_APP_DAILY_REMINDER':
      return '/streak';
    default:
      if (code.includes('COURSE') || code.includes('LESSON')) return '/courses';
      return '/notifications';
  }
}

export function routeForInboxItem(item: {
  template_code: string;
  destination?: NotificationDestination | null;
}): AppRoute {
  const destination = parseDestination(item.destination);
  if (destination && destination.kind !== 'INBOX') return routeForDestination(destination);
  const fallback = routeForTemplate(item.template_code);
  // Tapping inside the inbox should not "navigate" to the inbox again.
  return fallback;
}
