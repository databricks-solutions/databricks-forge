import { Skeleton } from "@/components/ui/skeleton";

export default function OutcomesIngestLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-5 w-96" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-16" />
            {i < 3 && <Skeleton className="h-0.5 w-8" />}
          </div>
        ))}
      </div>

      {/* Content area */}
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
