export interface AmmParams {
  floorPrice: number;
  paramA: number;
  paramB: number;
}

export function spotPrice(supply: number, p: AmmParams): number {
  if (supply < 0) supply = 0;
  return p.floorPrice + p.paramA * Math.log(1 + supply / p.paramB);
}

function primitiveAt(x: number, p: AmmParams): number {
  const { floorPrice: F, paramA: A, paramB: B } = p;
  if (x < 0) x = 0;
  return (F - A) * x + A * (B + x) * Math.log(1 + x / B);
}

export function costToBuy(supply: number, qty: number, p: AmmParams): number {
  if (qty <= 0) return 0;
  if (supply < 0) supply = 0;
  return primitiveAt(supply + qty, p) - primitiveAt(supply, p);
}

export function payoutToSell(supply: number, qty: number, p: AmmParams): number {
  if (qty <= 0) return 0;
  if (supply < qty) qty = supply;
  return primitiveAt(supply, p) - primitiveAt(supply - qty, p);
}

export function avgBuyPrice(supply: number, qty: number, p: AmmParams): number {
  if (qty <= 0) return spotPrice(supply, p);
  return costToBuy(supply, qty, p) / qty;
}

export function avgSellPrice(supply: number, qty: number, p: AmmParams): number {
  if (qty <= 0) return spotPrice(supply, p);
  return payoutToSell(supply, qty, p) / qty;
}

export function priceImpactPct(supply: number, qty: number, type: "BUY" | "SELL", p: AmmParams): number {
  const cur = spotPrice(supply, p);
  if (cur === 0) return 0;
  const newSupply = type === "BUY" ? supply + qty : Math.max(0, supply - qty);
  const next = spotPrice(newSupply, p);
  return ((next - cur) / cur) * 100;
}

export function supplyForPrice(price: number, p: AmmParams): number {
  const { floorPrice: F, paramA: A, paramB: B } = p;
  if (price <= F) return 0;
  return B * (Math.exp((price - F) / A) - 1);
}

export const DEFAULT_AMM_PARAMS: AmmParams = {
  floorPrice: 5,
  paramA: 5,
  paramB: 100,
};
