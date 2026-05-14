import { Star } from "lucide-react";

export function StarButton({ 
  vaultId, 
  isWatched, 
  onAdd, 
  onRemove, 
  size = 4 
}: { 
  vaultId: number; 
  isWatched: boolean; 
  onAdd: (id: number) => void; 
  onRemove: (id: number) => void;
  size?: number;
}) {
  return (
    <button 
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("watchlist_click", { vaultId, currentlyWatched: isWatched });
        if (isWatched) {
          onRemove(vaultId);
        } else {
          onAdd(vaultId);
        }
      }}
      className="p-2 hover:bg-white/10 rounded-full transition-colors relative z-10 flex items-center justify-center min-w-[32px] min-h-[32px]"
      data-testid={`button-watchlist-${vaultId}`}
    >
      <Star className={`w-${size} h-${size} ${isWatched ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />
    </button>
  );
}
