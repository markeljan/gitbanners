import { Skeleton } from "@astryxdesign/core/Skeleton";

/** One card of the grid while the list loads: the frame, a name, a line. */
export function SavedBannerSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div className="gb-saved" aria-hidden="true">
      <div className="gb-saved-frame">
        <Skeleton radius="none" index={index} />
      </div>
      <div className="gb-saved-body">
        <Skeleton width="45%" height={20} index={index} />
        <Skeleton width="70%" height={14} index={index} />
        <Skeleton width={180} height={28} index={index} />
      </div>
    </div>
  );
}

/** The grid of saved banners while it loads. */
export function SavedGridSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="gb-saved-grid">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <SavedBannerSkeleton key={index} index={index} />
      ))}
    </div>
  );
}

/**
 * The signed-in dashboard while the session is asked for: the same frame
 * as the real thing, so nothing moves when it arrives.
 */
export function DashboardSkeleton() {
  return (
    <div className="gb-dash" aria-busy="true">
      <output className="sr-only">Loading your dashboard</output>
      <div className="gb-dash-head" aria-hidden="true">
        <div className="gb-dash-title">
          <Skeleton width={200} height={28} />
          <Skeleton width={160} height={14} />
        </div>
        <Skeleton width={128} height={32} />
      </div>
      <div className="gb-dash-cols">
        <div className="gb-dash-main">
          <SavedGridSkeleton />
        </div>
        <div className="gb-dash-side" aria-hidden="true">
          <Skeleton height={320} radius={4} />
          <Skeleton height={240} radius={4} />
        </div>
      </div>
    </div>
  );
}
