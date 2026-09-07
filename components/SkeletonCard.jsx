/** Placeholder card with CSS shimmer for loading states. */
export default function SkeletonCard({ circle = false }) {
  return (
    <div className="w-40 sm:w-44 shrink-0" aria-hidden="true">
      <div className={`shimmer aspect-square w-full ${circle ? "rounded-full" : "rounded-lg"}`} />
      <div className="shimmer mt-3 h-3.5 w-4/5 rounded" />
      <div className="shimmer mt-2 h-3 w-3/5 rounded" />
    </div>
  );
}
