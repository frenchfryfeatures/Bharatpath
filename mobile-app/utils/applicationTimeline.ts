/**
 * The "Where things stand" timeline on an application (2026-11-23).
 * Pure, so the board screen and tests share one rule.
 */
import {
  type ApplicationStage,
  type CandidateHistoryItem,
  PIPELINE,
  isActiveStage,
  stageLabel,
} from '@/types/application';

export interface TimelineItem {
  label: string;
  sub: string | null;
  /** `ended`: the application closed here (withdrawn, not selected, expired). */
  state: 'done' | 'current' | 'pending' | 'ended';
}

const PIPELINE_LABELS = [
  'Application sent',
  'Profile opened by employer',
  'Shortlisted',
  'Interview',
  'Decision',
] as const;

const CLOSED_LABELS: Partial<Record<ApplicationStage, string>> = {
  WITHDRAWN: 'Withdrawn by you',
  REJECTED: 'Not selected',
  EXPIRED: 'Closed with no response',
};

/**
 * The timeline shows only what actually happened (2026-11-23).
 *
 * An open application: stages before the current one are done, the current
 * one is in progress, the rest are still to come. A closed one: the stages
 * it really reached (read from its history) are done, followed by how it
 * ended -- a withdrawal straight after applying is "Application sent", then
 * "Withdrawn by you", never five ticks. A hire completes every stage.
 */
export function buildTimeline(
  history: CandidateHistoryItem[],
  currentStage: ApplicationStage,
): TimelineItem[] {
  const indexOf = (stage: ApplicationStage | null | undefined) =>
    stage ? (PIPELINE as readonly string[]).indexOf(stage) : -1;

  // When each pipeline stage was first reached.
  const stageTimes: Record<number, string> = {};
  for (const h of history) {
    const idx = indexOf(h.to_stage);
    if (idx >= 0 && stageTimes[idx] == null) stageTimes[idx] = h.occurred_at;
  }
  const dateOf = (idx: number) =>
    stageTimes[idx] ? formatTimelineDate(stageTimes[idx]) : null;

  if (isActiveStage(currentStage)) {
    const currentIndex = indexOf(currentStage);
    return PIPELINE_LABELS.map((label, idx) => {
      if (idx < currentIndex) return { label, sub: dateOf(idx), state: 'done' };
      if (idx === currentIndex) {
        return { label, sub: stageStatusShort(currentStage), state: 'current' };
      }
      return { label, sub: null, state: 'pending' };
    });
  }

  const closedAt = [...history]
    .reverse()
    .find((h) => h.to_stage === currentStage)?.occurred_at;

  if (currentStage === 'HIRED') {
    return PIPELINE_LABELS.map((label, idx) => ({
      label,
      sub:
        idx === PIPELINE_LABELS.length - 1
          ? `Hired${closedAt ? ` · ${formatTimelineDate(closedAt)}` : ''}`
          : dateOf(idx),
      state: 'done',
    }));
  }

  // The furthest stage this application really reached before it closed.
  let reached = 0;
  for (const h of history) {
    reached = Math.max(reached, indexOf(h.to_stage), indexOf(h.from_stage));
  }
  const steps: TimelineItem[] = PIPELINE_LABELS.slice(0, reached + 1).map(
    (label, idx) => ({ label, sub: dateOf(idx), state: 'done' }),
  );
  steps.push({
    label: CLOSED_LABELS[currentStage] ?? stageLabel(currentStage),
    sub: closedAt ? formatTimelineDate(closedAt) : null,
    state: 'ended',
  });
  return steps;
}

export function stageStatusShort(stage: ApplicationStage): string {
  switch (stage) {
    case 'SUBMITTED':
      return 'Waiting on employer';
    case 'VIEWED':
      return 'Opened by employer';
    case 'SHORTLISTED':
      return 'Shortlisted';
    case 'INTERVIEW':
      return 'Scheduled';
    case 'DECISION':
      return 'Pending';
    default:
      return stageLabel(stage);
  }
}

export function formatTimelineDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}
