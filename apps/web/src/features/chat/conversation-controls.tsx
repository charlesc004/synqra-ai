"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { api, json } from "@/lib/api/client";
import { useWorkspace } from "@/providers/workspace";
import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/ui/dialog";
import { ConfirmDialog, ErrorState } from "@/components/shared";
export function ConversationControls({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const { workspace } = useWorkspace(),
    cache = useQueryClient(),
    router = useRouter();
  const [edit, setEdit] = useState(false),
    [remove, setRemove] = useState(false),
    [name, setName] = useState(title);
  const mutation = useMutation({
    mutationFn: (deleting: boolean) =>
      api(
        `/conversations/${id}`,
        {
          method: deleting ? "DELETE" : "PATCH",
          ...(!deleting ? json({ title: name }) : {}),
        },
        workspace?.id,
      ),
    onSuccess: async (_, deleting) => {
      await cache.invalidateQueries({ queryKey: ["conversations"] });
      await cache.invalidateQueries({ queryKey: ["conversation"] });
      setEdit(false);
      setRemove(false);
      if (deleting) router.push("/chat");
    },
  });
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Rename conversation"
        onClick={() => setEdit(true)}
      >
        <Pencil size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete conversation"
        onClick={() => setRemove(true)}
      >
        <Trash2 size={14} />
      </Button>
      <AppDialog open={edit} onOpenChange={setEdit} title="Rename conversation">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(false);
          }}
        >
          <label>
            Conversation title
            <input
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {mutation.error && <ErrorState error={mutation.error} />}
          <Button disabled={mutation.isPending}>Save name</Button>
        </form>
      </AppDialog>
      <ConfirmDialog
        open={remove}
        onClose={() => setRemove(false)}
        title="Delete this conversation?"
        description="This removes its saved messages and citations."
        busy={mutation.isPending}
        onConfirm={() => mutation.mutate(true)}
      />
    </>
  );
}
