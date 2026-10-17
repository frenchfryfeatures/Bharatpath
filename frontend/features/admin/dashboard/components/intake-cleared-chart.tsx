import type {
  IntakeClearedItem,
} from "@/store/admin/dashboard/slice";

interface IntakeClearedChartProps {
  data: IntakeClearedItem[];
}

export function IntakeClearedChart({
  data,
}: IntakeClearedChartProps) {
  const totalIn = data.reduce(
    (sum, item) => sum + item.intake,
    0,
  );

  const totalOut = data.reduce(
    (sum, item) => sum + item.cleared,
    0,
  );

  const difference = totalIn - totalOut;

  const throughputHeadline =
    difference > 0
      ? `+${difference} added to backlog`
      : `${Math.abs(difference)} cleared from backlog`;

  const throughputChipClass =
    difference > 0
      ? "bg-[#fff4df] text-[#a86500]"
      : "bg-[#e6f6ec] text-[#1f8a4c]";

  return (
    <section className="rounded-[12px] border border-[#e5e7ec] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)]">
      {/* ================================================================ */}
      {/* Header                                                           */}
      {/* ================================================================ */}

      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2
            className="text-[14px] font-semibold leading-[18px] text-[#151b2b]"
            style={{
              fontFamily: "'General Sans', sans-serif",
            }}
          >
            Intake vs cleared
          </h2>

          <p
            className="text-[12px] leading-[17px] text-[#777f90]"
            style={{
              fontFamily: "'General Sans', sans-serif",
            }}
          >
            Last 14 days, all queues
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${throughputChipClass}`}
          style={{
            fontFamily: "'General Sans', sans-serif",
          }}
        >
          {throughputHeadline}
        </span>
      </div>

      {/* ================================================================ */}
      {/* Chart                                                            */}
      {/* ================================================================ */}

      <div className="mt-4 flex h-24 items-end gap-2.5">
        {data.map((item) => (
          <div
            key={item.date}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
            title={`${item.dateLabel}: ${item.intake} arrived, ${item.cleared} cleared`}
          >
            <div
              className="flex h-full w-full items-end gap-1"
            >
              {/* Intake */}

              <div className="flex h-full flex-1 items-end">
                <span
                  className="block w-full rounded-t-[4px] bg-[#dfe2e7]"
                  style={{
                    height: `${item.intakeHeight}%`,
                  }}
                />
              </div>

              {/* Cleared */}

              <div className="flex h-full flex-1 items-end">
                <span
                  className="block w-full rounded-t-[4px] bg-[#1f8a4c]"
                  style={{
                    height: `${item.clearedHeight}%`,
                  }}
                />
              </div>
            </div>

            <time
              dateTime={item.date}
              className="text-[11px] font-medium text-[#777f90]"
              style={{
                fontFamily: "'General Sans', sans-serif",
              }}
            >
              {item.day}
            </time>
          </div>
        ))}
      </div>

      <p className="mt-1 text-center text-[10px] font-medium text-[#777f90]">
        Date (day of month)
      </p>

      {/* ================================================================ */}
      {/* Footer                                                           */}
      {/* ================================================================ */}

      <p
        className="mt-3 border-t border-[#eef0f3] pt-3 text-[12px] leading-[17px] text-[#777f90]"
        style={{
          fontFamily: "'General Sans', sans-serif",
        }}
      >
        Grey is what arrived, colour is what operators
        cleared. {totalIn} in, {totalOut} out over 14 days.
      </p>
    </section>
  );
}
