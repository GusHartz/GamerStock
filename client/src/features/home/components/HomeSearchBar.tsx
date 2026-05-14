import { useState } from "react";
import { Search } from "lucide-react";

const QUICK_FILTERS = ["All", "CS2", "NaVi", "FURIA", "IEM Cologne", "LoL"];

interface HomeSearchBarProps {
  onFilterChange?: (filter: string) => void;
}

export function HomeSearchBar({ onFilterChange }: HomeSearchBarProps) {
  const [active, setActive] = useState("All");
  const [query, setQuery] = useState("");

  function handleFilter(f: string) {
    setActive(f);
    onFilterChange?.(f);
  }

  return (
    <div
      data-testid="home-search-bar"
      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 py-1.5 px-2.5 rounded-lg bg-[#0B0F1E]/60 border border-white/[0.06] shadow-[0_4px_20px_-6px_rgba(0,0,0,0.8)]"
    >
      {/* Search input */}
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600 pointer-events-none" />
        <input
          data-testid="input-search-home"
          type="text"
          placeholder="Search assets or player tags…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none font-mono text-[12px]"
        />
      </div>

      <div className="w-px bg-white/[0.06] hidden sm:block self-stretch" />

      {/* Quick filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {QUICK_FILTERS.map(f => (
          <button
            key={f}
            data-testid={`button-filter-${f.toLowerCase().replace(/\s+/g, "-")}`}
            onClick={() => handleFilter(f)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-medium border transition-all duration-150 ${
              active === f
                ? "bg-cyan-500/20 border-cyan-500/35 text-cyan-400 shadow-[0_0_8px_-2px_rgba(6,182,212,0.3)]"
                : "bg-transparent border-white/[0.06] text-zinc-600 hover:border-white/[0.14] hover:text-zinc-300"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  );
}
