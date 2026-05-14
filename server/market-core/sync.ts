import { riotLolChallengerNA1Provider } from "../providers/riot";
import { upsertAssetsFromProvider } from "./asset-registry";

export async function syncCanonicalMarket() {
  const rows = await riotLolChallengerNA1Provider.fetch();
  const upserted = await upsertAssetsFromProvider(rows);
  return { fetched: rows.length, upserted: upserted.length };
}
