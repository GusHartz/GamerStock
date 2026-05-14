export function HomeSkeleton() {
  return (
    <div className="space-y-5 animate-pulse pb-8">
      {/* Pulse ticker */}
      <div className="h-9 rounded-lg bg-white/[0.04] border border-white/[0.06]" />

      {/* Top row: Hero + Upcoming side-by-side */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Hero */}
        <div className="flex-1 min-w-0 h-[300px] rounded-xl bg-white/[0.04] border border-white/[0.06]" />
        {/* Upcoming panel */}
        <div className="w-full lg:w-[300px] xl:w-[320px] flex-none h-[300px] rounded-xl bg-white/[0.04] border border-white/[0.06]" />
      </div>

      {/* Featured row */}
      <div className="space-y-3">
        <div className="h-4 w-28 rounded bg-white/[0.06]" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="w-[260px] flex-none h-[164px] rounded-xl bg-white/[0.04] border border-white/[0.06]" />
          ))}
        </div>
      </div>

      {/* Trade Markets rail */}
      <div className="space-y-3">
        <div className="h-4 w-36 rounded bg-white/[0.06]" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="w-[152px] flex-none h-[188px] rounded-xl bg-white/[0.04] border border-white/[0.06]" />
          ))}
        </div>
      </div>
    </div>
  );
}
