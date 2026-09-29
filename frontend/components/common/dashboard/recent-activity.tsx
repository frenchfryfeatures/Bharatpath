"use client";

import {
  FileText,
  GraduationCap,
  LoaderCircle,
  Receipt,
  UserPlus,
} from "lucide-react";
import {
  useEffect,
  useRef,
  type UIEvent,
} from "react";

type RecentActivityType =
  | "link"
  | "upload"
  | "hire"
  | "invoice";

interface RecentActivity {
  id: string;
  text: string;
  time: string;
  type: RecentActivityType;
}

interface RecentActivityProps {
  activities: RecentActivity[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

const icons = {
  link: UserPlus,
  upload: FileText,
  hire: GraduationCap,
  invoice: Receipt,
};

const toneClasses = {
  link: "bg-[#eef0ff] text-[#4e43b7]",
  upload: "bg-[#f0f1f4] text-[#4f5666]",
  hire: "bg-[#e6f6ec] text-[#1f8a4c]",
  invoice: "bg-[#fdf1e0] text-[#b5650b]",
};

export function RecentActivityList({
  activities,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: RecentActivityProps) {
  const loadRequested = useRef(false);

  useEffect(() => {
    if (!isLoadingMore) {
      loadRequested.current = false;
    }
  }, [activities.length, isLoadingMore]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const viewport = event.currentTarget;
    const distanceFromBottom =
      viewport.scrollHeight -
      viewport.scrollTop -
      viewport.clientHeight;

    if (
      distanceFromBottom <= 80 &&
      hasMore &&
      !isLoadingMore &&
      !loadRequested.current &&
      onLoadMore
    ) {
      loadRequested.current = true;
      onLoadMore();
    }
  }

  return (
    <div className="flex min-h-[220px] flex-col rounded-xl border border-[#e5e7ec] bg-white p-5 transition-all duration-150 hover:-translate-y-px hover:border-[#d9dce4] hover:shadow-[0_6px_18px_rgba(19,26,38,0.05)]">
      <h2 className="text-sm font-semibold text-[#252b3b]">
        Recent activity
      </h2>

      {activities.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-8 text-center">
          <p className="text-[13px] leading-[18px] text-[#8a91a0]">
            Recent activity will appear here when the activity feed becomes
            available.
          </p>
        </div>
      ) : (
        <div
          aria-busy={isLoadingMore}
          aria-label="Recent activity feed"
          tabIndex={0}
          onScroll={handleScroll}
          className="
            mt-5
            max-h-[320px]
            space-y-5
            overflow-y-auto
            pr-1

            [&::-webkit-scrollbar]:w-[6px]
            [&::-webkit-scrollbar-track]:bg-transparent
            [&::-webkit-scrollbar-thumb]:rounded-full
            [&::-webkit-scrollbar-thumb]:bg-[#c7cbd2]
            [&::-webkit-scrollbar-thumb]:hover:bg-[#b5bac3]
          "
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "#c7cbd2 transparent",
          }}
        >
          {activities.map((activity) => {
            const Icon = icons[activity.type];

            return (
              <div
                key={activity.id}
                className="flex gap-3"
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneClasses[activity.type]}`}
                >
                  <Icon size={16} />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[#252b3b]">
                    {activity.text}
                  </p>

                  <p className="mt-0.5 text-xs text-[#8a91a0]">
                    {activity.time}
                  </p>
                </div>
              </div>
            );
          })}

          {isLoadingMore ? (
            <div
              role="status"
              className="flex items-center justify-center gap-2 py-2 text-xs text-[#8a91a0]"
            >
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading more activity...
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}