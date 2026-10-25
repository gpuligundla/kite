import type { Band } from "@/lib/band";
import { StoryHarness } from "./StoryHarness";

type Params = { id?: string; band?: string };
const BANDS: Band[] = ["k2", "g35", "g68", "g912"];

/** Dev harness: `?id=<story creation id>&band=k2` shows one story in the storybook player. */
export default async function DevStoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  return <StoryHarness id={p.id ?? ""} band={BANDS.find((b) => b === p.band) ?? "g35"} />;
}
