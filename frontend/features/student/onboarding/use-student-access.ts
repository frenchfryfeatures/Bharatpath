import { useGetCandidateSubscriptionQuery } from "@/store/student/billing.api";
import { useGetStudentCollegeLinksQuery } from "@/store/student/student.api";

/**
 * A student has access through a paid membership or a seat held through a
 * linked college; the API already treats both as access.
 */
export function useStudentHasAccess(skip = false) {
  const subscription = useGetCandidateSubscriptionQuery(undefined, { skip });
  const links = useGetStudentCollegeLinksQuery(undefined, { skip });
  const seated = Boolean(links.data?.some((link) => link.seatHeld && !link.revokedAt));
  return {
    subscription,
    seated,
    hasAccess: Boolean(subscription.data?.has_access) || seated,
  };
}
