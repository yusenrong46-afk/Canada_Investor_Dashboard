interface ResultSkeletonProps {
  rows?: number;
  className?: string;
}

export function ResultSkeleton({ rows = 3, className = "" }: ResultSkeletonProps) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="animate-pulse rounded-field bg-line/60" style={{ height: index === 0 ? "2.75rem" : "1.25rem", width: index === 0 ? "55%" : `${70 - index * 10}%` }} />
      ))}
    </div>
  );
}
