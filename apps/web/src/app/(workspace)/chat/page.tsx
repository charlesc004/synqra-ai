import { Suspense } from "react";
import { ChatPage } from "@/features/chat/chat-page";
import { LoadingSkeleton } from "@/components/shared";
export default function Chat() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ChatPage />
    </Suspense>
  );
}
