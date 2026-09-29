import { Skeleton } from "@/components/common/loading";

const TOTAL_ROWS = [
  { labelWidth: "42%", valueWidth: 28 },
  { labelWidth: "38%", valueWidth: 24 },
  { labelWidth: "46%", valueWidth: 30 },
  { labelWidth: "44%", valueWidth: 34 },
  { labelWidth: "40%", valueWidth: 30 },
  { labelWidth: "48%", valueWidth: 26 },
] as const;

const BAR_HEIGHTS = [
  [42, 58],
  [70, 46],
  [52, 76],
  [64, 38],
  [45, 68],
  [74, 54],
  [56, 82],
  [68, 48],
  [50, 72],
  [78, 60],
  [58, 44],
  [72, 66],
  [48, 74],
  [62, 52],
] as const;

export function PlatformTotalsSkeleton() {
  return (
    <section
      role="status"
      aria-label="Loading platform totals"
      aria-busy="true"
      className="rounded-[12px] border border-[#e5e7ec] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)]"
    >
      <span className="sr-only">Loading platform totals…</span>
      <Skeleton width={112} height={18} radius={6} />

      <div className="mt-3">
        {TOTAL_ROWS.map((row, index) => (
          <div
            key={`${row.labelWidth}-${row.valueWidth}`}
            className={`flex items-center gap-2.5 py-3 ${
              index === 0 ? "pt-1" : "border-t border-[#eef0f3]"
            }`}
          >
            <Skeleton width={32} height={32} radius={8} />
            <Skeleton width={row.labelWidth} height={13} radius={6} />
            <Skeleton
              className="ml-auto"
              width={row.valueWidth}
              height={18}
              radius={6}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function IntakeClearedSkeleton() {
  return (
    <section
      role="status"
      aria-label="Loading intake versus cleared chart"
      aria-busy="true"
      className="rounded-[12px] border border-[#e5e7ec] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)]"
    >
      <span className="sr-only">Loading intake versus cleared chart…</span>

      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton width={128} height={18} radius={6} />
          <Skeleton width={108} height={12} radius={6} />
        </div>
        <Skeleton width={112} height={24} radius={999} />
      </div>

      <div className="mt-4 flex h-24 items-end gap-2.5">
        {BAR_HEIGHTS.map(([intake, cleared], index) => (
          <div
            key={`${intake}-${cleared}-${index}`}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
          >
            <div className="flex h-full w-full items-end gap-1">
              <Skeleton
                className="min-w-0 flex-1"
                height={`${intake}%`}
                radius={4}
              />
              <Skeleton
                className="min-w-0 flex-1"
                height={`${cleared}%`}
                radius={4}
              />
            </div>
            <Skeleton width="70%" height={11} radius={5} />
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-[#eef0f3] pt-3">
        <Skeleton width="88%" height={12} radius={6} />
      </div>
    </section>
  );
}
