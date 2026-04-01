import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "@/lib/moodboard-data";

type BoardRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  accent: string;
  shared: boolean;
  collaborators: string[] | null;
  data: Pick<Workspace, "view" | "items">;
  updated_at: string;
};

export function mapBoardRowToWorkspace(row: BoardRow): Workspace {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    accent: row.accent,
    shared: row.shared,
    collaborators: row.collaborators ?? [],
    updatedAt: row.updated_at,
    view: row.data?.view,
    items: row.data?.items ?? [],
  };
}

export function mapWorkspaceToBoardRow(
  workspace: Workspace,
  ownerId: string,
): BoardRow {
  return {
    id: workspace.id,
    owner_id: workspace.ownerId ?? ownerId,
    name: workspace.name,
    description: workspace.description,
    accent: workspace.accent,
    shared: workspace.shared,
    collaborators: workspace.collaborators,
    data: {
      view: workspace.view,
      items: workspace.items,
    },
    updated_at: workspace.updatedAt,
  };
}

export async function fetchRemoteBoards(
  supabase: SupabaseClient,
  userId: string,
) {
  return supabase
    .from("boards")
    .select(
      "id, owner_id, name, description, accent, shared, collaborators, data, updated_at",
    )
    .or(`owner_id.eq.${userId},shared.eq.true`)
    .order("updated_at", { ascending: false });
}

export async function upsertRemoteBoards(
  supabase: SupabaseClient,
  workspaces: Workspace[],
  userId: string,
) {
  const ownedBoards = workspaces
    .filter((workspace) => !workspace.ownerId || workspace.ownerId === userId)
    .map((workspace) => mapWorkspaceToBoardRow(workspace, userId));

  if (ownedBoards.length === 0) {
    return { error: null };
  }

  return supabase.from("boards").upsert(ownedBoards, { onConflict: "id" });
}

export async function updateSharedRemoteBoards(
  supabase: SupabaseClient,
  workspaces: Workspace[],
  userId: string,
) {
  const sharedBoards = workspaces.filter(
    (workspace) =>
      workspace.ownerId &&
      workspace.ownerId !== userId &&
      workspace.shared,
  );

  if (sharedBoards.length === 0) {
    return { error: null };
  }

  const results = await Promise.all(
    sharedBoards.map((workspace) =>
      supabase
        .from("boards")
        .update({
          name: workspace.name,
          description: workspace.description,
          accent: workspace.accent,
          shared: workspace.shared,
          collaborators: workspace.collaborators,
          data: {
            view: workspace.view,
            items: workspace.items,
          },
          updated_at: workspace.updatedAt,
        })
        .eq("id", workspace.id),
    ),
  );

  const failure = results.find((result) => result.error);
  return { error: failure?.error ?? null };
}

export async function deleteRemoteBoard(
  supabase: SupabaseClient,
  workspaceId: string,
) {
  return supabase.from("boards").delete().eq("id", workspaceId);
}
