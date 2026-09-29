import Link from "next/link";

import type {
  OldestDashboardItem,
} from "@/store/admin/dashboard/slice";

interface OldestItemsProps {
  items: OldestDashboardItem[];
}

function getTypeClasses(
  type: OldestDashboardItem["type"],
) {
  if (type === "KYB") {
    return "bg-[#eef0ff] text-[#4e43b7]";
  }

  if (type === "Dispute") {
    return "bg-[#fdecec] text-[#c43d3d]";
  }

  return "bg-[#fff4df] text-[#a86500]";
}

function getRiskClasses(
  risk: OldestDashboardItem["risk"],
) {
  switch (risk) {
    case "High":
      return "bg-[#fdecec] text-[#c43d3d]";

    case "Medium":
      return "bg-[#fff4df] text-[#a86500]";

    case "Low":
    default:
      return "bg-[#f1f3f6] text-[#697386]";
  }
}

function getAvatarClasses(
  type: OldestDashboardItem["type"],
) {
  if (type === "KYB") {
    return "bg-[#eef0ff] text-[#4e43b7]";
  }

  if (type === "Dispute") {
    return "bg-[#fdecec] text-[#c43d3d]";
  }

  return "bg-[#fff4df] text-[#a86500]";
}

export function OldestItems({
  items,
}: OldestItemsProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#e5e7ec] bg-white lg:h-[530px] lg:max-h-[568px]">
      {/* ================================================================ */}
      {/* Header                                                           */}
      {/* ================================================================ */}

      <div className="flex shrink-0 items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <h2
            className="text-[14px] font-semibold leading-[20px] text-[#151b2b]"
            style={{
              fontFamily: "'General Sans', sans-serif",
            }}
          >
            Oldest items waiting
          </h2>

          <p
            className="mt-0.5 text-[12px] leading-[18px] text-[#777f90]"
            style={{
              fontFamily: "'General Sans', sans-serif",
            }}
          >
            Items that need operator attention first.
          </p>
        </div>

        <Link
          href="/admin/queue"
          className="shrink-0 rounded-[8px] px-2.5 py-2 text-[12px] font-semibold text-[#4e43b7] transition-colors hover:bg-[#f1f0ff]"
        >
          View queue
        </Link>
      </div>

      {/* ================================================================ */}
      {/* Table                                                            */}
      {/* ================================================================ */}

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
        <div className="min-w-[640px]">
          {/* Header */}

          <div className="grid grid-cols-[minmax(180px,1.6fr)_120px_104px_88px] gap-3 border-t border-[#eef0f3] bg-[#fafbfc] px-5 py-3">
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a91a0]"
              style={{
                fontFamily: "'General Sans', sans-serif",
              }}
            >
              Subject
            </span>

            <span
              className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a91a0]"
              style={{
                fontFamily: "'General Sans', sans-serif",
              }}
            >
              Type
            </span>

            <span
              className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a91a0]"
              style={{
                fontFamily: "'General Sans', sans-serif",
              }}
            >
              Risk
            </span>

            <span
              className="text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a91a0]"
              style={{
                fontFamily: "'General Sans', sans-serif",
              }}
            >
              Waiting
            </span>
          </div>

          {/* Rows */}

          {items.map((item, index) => (
            <div
              key={`${item.name}-${item.waiting}-${index}`}
              className="grid grid-cols-[minmax(180px,1.6fr)_120px_104px_88px] gap-3 border-t border-[#eef0f3] px-5 py-3"
            >
              {/* Subject */}

              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${getAvatarClasses(
                    item.type,
                  )}`}
                  style={{
                    fontFamily: "'General Sans', sans-serif",
                  }}
                >
                  {item.initials}
                </div>

                <div className="flex min-w-0 flex-col gap-0.5">
                  <span
                    className="truncate text-[13px] font-semibold text-[#151b2b]"
                    style={{
                      fontFamily: "'General Sans', sans-serif",
                    }}
                  >
                    {item.name}
                  </span>

                  <span
                    className="truncate text-[11px] text-[#777f90]"
                    style={{
                      fontFamily: "'General Sans', sans-serif",
                    }}
                  >
                    {item.meta}
                  </span>
                </div>
              </div>

              {/* Type */}

              <div className="flex items-center">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getTypeClasses(
                    item.type,
                  )}`}
                  style={{
                    fontFamily: "'General Sans', sans-serif",
                  }}
                >
                  {item.type}
                </span>
              </div>

              {/* Risk */}

              <div className="flex items-center">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getRiskClasses(
                    item.risk,
                  )}`}
                  style={{
                    fontFamily: "'General Sans', sans-serif",
                  }}
                >
                  {item.risk}
                </span>
              </div>

              {/* Waiting */}

              <div
                className="flex items-center justify-end text-[13px] font-semibold text-[#4b5565]"
                style={{
                  fontFamily: "'General Sans', sans-serif",
                }}
              >
                {item.waiting}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}