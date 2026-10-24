import { OsScreen } from "./OsScreen";

export default async function OsPage({ searchParams }: { searchParams: Promise<{ device?: string }> }) {
  const { device } = await searchParams;
  return <OsScreen device={device === "handheld" ? "handheld" : "os"} />;
}
