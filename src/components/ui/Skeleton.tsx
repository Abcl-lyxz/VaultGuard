interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}

export function Skeleton({ width = "100%", height = "16px", radius = "var(--r-sm)", className = "" }: SkeletonProps) {
  return (
    <span
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius: radius, display: "block" }}
      aria-hidden="true"
    />
  );
}

export function ItemRowSkeleton() {
  return (
    <div className="item-row-skeleton">
      <Skeleton width="32px" height="32px" radius="var(--r-md)" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
        <Skeleton width="60%" height="13px" />
        <Skeleton width="40%" height="11px" />
      </div>
    </div>
  );
}
