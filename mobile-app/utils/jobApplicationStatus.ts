import { stageLabel, type ApplicationStage } from '@/types/application';
import type { EligibilityStatus } from '@/types/job';

export function jobApplicationStatus(eligibility: EligibilityStatus, stage?: ApplicationStage | null, loading = false, error = false) {
  if (stage) return { label: stage === 'SUBMITTED' ? 'Applied' : stageLabel(stage), kind: 'application' as const };
  if (loading) return { label: 'Checking application status…', kind: 'unknown' as const };
  if (error) return { label: 'Status unavailable · pull to retry', kind: 'unknown' as const };
  return { label: eligibility === 'ELIGIBLE' ? 'You can apply' : eligibility === 'SCORE_PENDING' ? 'Bharatpath Score updating' : 'Not eligible', kind: 'eligibility' as const };
}
