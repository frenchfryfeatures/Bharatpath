import { FormSkeleton, Skeleton } from "@/components/common/loading";

const TAB_WIDTHS = [88, 36, 94, 72];

export default function CollegeSettingsLoading() {
  return (
    <div className="min-h-full bg-[#f8f9fb]">
      <div className="flex h-[49px] items-center overflow-hidden border-b border-[#e1e5eb]">
        {TAB_WIDTHS.map((width) => (
          <Skeleton
            key={width}
            className="mx-4 shrink-0"
            width={width}
            height={12}
            radius={6}
          />
        ))}
      </div>

      <main className="py-5">
        <div className="w-full max-w-[640px]">
          <FormSkeleton fields={5} />
        </div>
      </main>
    </div>
  );
}
