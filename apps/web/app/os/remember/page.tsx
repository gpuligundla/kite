import { RememberScreen } from "./RememberScreen";

/** `?grade=` previews another band, the way the kid screen's grade slider does. */
export default async function RememberPage({ searchParams }: { searchParams: Promise<{ grade?: string }> }) {
  const { grade } = await searchParams;
  const n = Number(grade);
  return <RememberScreen grade={grade !== undefined && Number.isInteger(n) && n >= 0 && n <= 12 ? n : undefined} />;
}
