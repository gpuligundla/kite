import { Harness, type Preview } from "./Harness";
import type { Band } from "@/lib/band";

type Params = { id?: string; band?: string; making?: string; step?: string };
const BANDS: Band[] = ["k2", "g35", "g68", "g912"];
const PREVIEWS: Preview[] = ["movie", "game", "brandNew"];

/** Dev harness. `?id=<creation>&band=k2` shows one card; `&making=brandNew&step=3` previews the making state. */
export default async function DevCreationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const band = BANDS.find((b) => b === p.band) ?? "g35";
  const making = PREVIEWS.find((m) => m === p.making);
  return <Harness id={p.id ?? ""} band={band} making={making} step={Number(p.step) || 0} />;
}
