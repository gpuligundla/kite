import { KiteOs } from "@/components/shell/KiteOs";

export default async function OsPage({ searchParams }: { searchParams: Promise<{ device?: string }> }) {
  const { device } = await searchParams;
  return <KiteOs device={device === "handheld" ? "handheld" : "os"} />;
}
