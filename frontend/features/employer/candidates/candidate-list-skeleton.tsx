import { Skeleton } from "@/components/common/loading";

interface CandidateListSkeletonProps {
  count?: number;
  className?: string;
}

const NAME_WIDTHS = [132, 164, 148];
const CONTACT_WIDTHS = [184, 216, 196];
const LOCATION_WIDTHS = [96, 116, 104];
const SKILL_WIDTHS = [
  [72, 88, 64, 78],
  [84, 68, 92],
  [62, 96, 76, 86, 58],
];

export function CandidateListSkeleton({
  count = 5,
  className = "",
}: Readonly<CandidateListSkeletonProps>) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={`flex flex-col gap-3 ${className}`}
    >
      <span className="sr-only">Loading candidates...</span>

      {Array.from({ length: count }).map((_, index) => {
        const variant = index % NAME_WIDTHS.length;

        return (
          <div
            key={index}
            aria-hidden="true"
            className="flex items-start gap-4 rounded-[12px] border border-[#e3e7eb] bg-white p-4 shadow-[0_2px_4px_rgba(19,26,38,0.04),0_8px_20px_rgba(19,26,38,0.05)]"
          >
            <Skeleton
              className="shrink-0"
              width={44}
              height={44}
              radius={12}
            />

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton
                  width={NAME_WIDTHS[variant]}
                  height={14}
                  radius={6}
                />
                <Skeleton width={64} height={22} radius={999} />
                <Skeleton width={102} height={21} radius={999} />
              </div>

              <Skeleton
                width={CONTACT_WIDTHS[variant]}
                height={10}
                radius={5}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Skeleton
                  width={LOCATION_WIDTHS[variant]}
                  height={11}
                  radius={5}
                />
                <Skeleton width={72} height={11} radius={5} />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {SKILL_WIDTHS[variant].map((width, skillIndex) => (
                  <Skeleton
                    key={skillIndex}
                    width={width}
                    height={22}
                    radius={999}
                  />
                ))}
              </div>
            </div>

            <Skeleton
              className="ml-auto shrink-0"
              width={88}
              height={32}
              radius={8}
            />
          </div>
        );
      })}
    </div>
  );
}
