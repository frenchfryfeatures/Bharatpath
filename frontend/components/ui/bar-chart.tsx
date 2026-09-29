export interface BarChartItem {
  label: string;
  value: number;
  /** Shown above the bar instead of `value`, e.g. "—" for a withheld count. */
  display?: string;
}

export interface BarChartProps {
  items: BarChartItem[];
  maxValue?: number;
  height?: number;
  barClassName?: string;
  className?: string;
}

export function BarChart({
  items,
  maxValue,
  height = 168,
  barClassName = "bg-[#3566b8]",
  className = "",
}: BarChartProps) {
  const peak = Math.max(maxValue ?? 0, ...items.map((item) => item.value), 1);

  return (
    <div
      className={`flex items-end justify-between gap-3 ${className}`}
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      {items.map((item) => {
        const barHeight = Math.max(8, Math.round((item.value / peak) * height));

        return (
          <div
            key={item.label}
            className="flex min-w-0 flex-1 flex-col items-center"
          >
            <span className="mb-1.5 text-[12px] font-semibold text-[#151b2b]">
              {item.display ?? item.value}
            </span>

            <div
              className="flex w-full items-end justify-center"
              style={{ height }}
            >
            
            <div
              className={`w-[100%] max-w-[204px] rounded-t-[8px] ${barClassName}`}
              style={{ height: barHeight }}
            />


            </div>

            <span className="mt-2 truncate text-[12px] font-medium text-[#5d6673]">
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
