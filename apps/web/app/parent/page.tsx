import { Suspense } from "react";
import { ParentScreen } from "./ParentScreen";

export default function ParentPage() {
  return (
    <Suspense>
      <ParentScreen />
    </Suspense>
  );
}
