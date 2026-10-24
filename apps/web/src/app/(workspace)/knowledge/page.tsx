import { Suspense } from "react";
import { KnowledgePage } from "@/features/knowledge/knowledge-page";
import { LoadingSkeleton } from "@/components/shared";
export default function Knowledge() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <KnowledgePage />
    </Suspense>
  );
}
