import { Skeleton } from "@astryxdesign/core/Skeleton";

/**
 * What the prerendered page shows until the studio has read its address:
 * the same grid with placeholders, so nothing moves when it arrives.
 */
export function StudioFallback() {
  return (
    <div className="gb-studio" aria-busy="true">
      <div className="gb-studio-head">
        <Skeleton width={120} height={20} />
      </div>
      <div className="gb-studio-bar">
        <Skeleton height={28} />
      </div>
      <div className="gb-studio-canvas">
        <div className="gb-stage-view" data-zoom="fit" data-backdrop="page">
          <div className="gb-fallback-banner">
            <Skeleton height="100%" radius={4} />
          </div>
        </div>
      </div>
      <div className="gb-studio-controls">
        <div className="gb-studio-group">
          <Skeleton height={32} />
          <Skeleton height={160} index={1} />
          <Skeleton height={240} index={2} />
        </div>
      </div>
      <div className="gb-studio-output">
        <Skeleton height={200} index={3} />
      </div>
    </div>
  );
}
