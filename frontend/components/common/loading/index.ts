/**
 * Centralised loading system - the single source of loaders and skeletons
 * shared by every BharatPath portal (admin / employer / college).
 */
export { Skeleton, SkeletonText } from "./skeleton";
export type { SkeletonProps, SkeletonTextProps } from "./skeleton";

export { Spinner } from "./spinner";
export type { SpinnerProps } from "./spinner";

export { PageLoader } from "./page-loader";
export type { PageLoaderProps } from "./page-loader";

export { TableSkeleton } from "./table-skeleton";
export type { TableSkeletonProps } from "./table-skeleton";

export { CardSkeleton, CardSkeletonGrid } from "./card-skeleton";
export type {
  CardSkeletonProps,
  CardSkeletonGridProps,
} from "./card-skeleton";

export { ListSkeleton } from "./list-skeleton";
export type { ListSkeletonProps } from "./list-skeleton";

export { FormSkeleton } from "./form-skeleton";
export type { FormSkeletonProps } from "./form-skeleton";

export { DetailSkeleton } from "./detail-skeleton";
export type { DetailSkeletonProps } from "./detail-skeleton";
