import { FormSkeleton, Skeleton } from "@/components/common/loading";

export function JobFormSkeleton() {
  return (
    <div className="w-full max-w-[800px]">
      <Skeleton className="mb-5" width={104} height={18} radius={6} />
      <FormSkeleton fields={6} />
    </div>
  );
}
