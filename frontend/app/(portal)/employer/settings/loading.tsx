import { FormSkeleton, Skeleton } from "@/components/common/loading";

const TAB_WIDTHS = [58, 38, 106, 82, 52, 112];

export default function EmployerSettingsLoading() {
  return (
    <div className="min-h-full bg-[#f7f8fa]">
      <div className="flex h-11 items-center overflow-hidden border-b border-[#e6e9ee]">
        {TAB_WIDTHS.map((width) => (
          <Skeleton
            key={width}
            className="mx-3.5 shrink-0"
            width={width}
            height={12}
            radius={6}
          />
        ))}
      </div>

      <main className="w-full max-w-[1000px] py-4">
        <div className="w-full max-w-[600px]">
          <FormSkeleton fields={5} />
        </div>
      </main>
    </div>
  );
}
