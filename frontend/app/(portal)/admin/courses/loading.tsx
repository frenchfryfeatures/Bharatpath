import { Skeleton } from "@/components/common/loading";

export default function CoursesLoading() {
  return (
    <div className="space-y-4 py-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
