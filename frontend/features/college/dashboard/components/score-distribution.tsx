import { DashboardBand } from "../types";

interface ScoreDistributionProps {
  bands: DashboardBand[];
  medianScore: number | null;
  belowFloor: boolean;
  minCohortSize: number;
}

const barColors = [
  "bg-[#8b7ef0]",
  "bg-[#6f80e8]",
  "bg-[#1f8a4c]",
  "bg-[#151b2b]",
];

const MAX_BAR_HEIGHT = 96;

export function ScoreDistribution({
  bands,
  medianScore,
  belowFloor,
  minCohortSize,
}: Readonly<ScoreDistributionProps>) {
  const totalConsenting = bands.reduce(
    (sum, band) => sum + (band.count ?? 0),
    0,
  );

  const maxCount = Math.max(
    ...bands.map((band) => band.count ?? 0),
    1,
  );

  return (
    <div className="rounded-xl border border-[#e5e7ec] bg-white p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#252b3b]">
            Cohort score distribution
          </h2>

          <p className="mt-1 text-xs text-[#8a91a0]">
            {belowFloor
              ? `Fewer than ${minCohortSize} consenting students`
              : `${totalConsenting} consenting students`}
          </p>
        </div>

        <span className="text-xl font-semibold text-[#151b2b]">
          {medianScore ?? 0}{" "}
          <span className="text-xs font-normal text-[#8a91a0]">
            median
          </span>
        </span>
      </div>

      {belowFloor ? (
        <p className="mt-8 rounded-lg bg-[#f5f6f8] p-4 text-xs text-[#697386]">
          The cohort is below the privacy floor, so individual band
          counts are withheld until more students consent to share.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-4 gap-4">
          {bands.map((band, index) => {
            const count = band.count ?? 0;
            const barHeight = Math.max(
              4,
              Math.round((count / maxCount) * MAX_BAR_HEIGHT),
            );

            return (
              <div key={band.label}>
                <p className="text-lg font-semibold text-[#151b2b]">
                  {band.count ?? 0}
                </p>

                <div
                  className="mt-3 flex items-end"
                  style={{ height: MAX_BAR_HEIGHT }}
                >
                  <div
                    className={`w-full rounded-t-sm ${
                      barColors[index % barColors.length]
                    }`}
                    style={{ height: barHeight }}
                  />
                </div>

                <p className="mt-3 text-sm font-semibold text-[#252b3b]">
                  {band.label}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-[#8a91a0]">
        Only students who consented to share are counted.
      </p>
    </div>
  );
}
