"use client";
/* eslint-disable @next/next/no-img-element */

import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  BOARD_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  defaultView,
  initialAppState,
  type AppState,
  type BoardItem,
  type ImageItem,
  type TextItem,
  type Workspace,
} from "@/lib/moodboard-data";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";

const STORAGE_KEY = "muse-board-state-v1";

type MoodboardStudioProps = {
  initialUser: User | null;
  isSupabaseConfigured: boolean;
};

type PointerAction =
  | {
      type: "pan";
      workspaceId: string;
      startClientX: number;
      startClientY: number;
      originPanX: number;
      originPanY: number;
    }
  | {
      type: "move";
      workspaceId: string;
      itemId: string;
      startClientX: number;
      startClientY: number;
      originX: number;
      originY: number;
      zoom: number;
      itemWidth: number;
      itemHeight: number;
    }
  | {
      type: "resize";
      workspaceId: string;
      itemId: string;
      startClientX: number;
      startClientY: number;
      originWidth: number;
      originHeight: number;
      zoom: number;
      itemX: number;
      itemY: number;
      minWidth: number;
      minHeight: number;
    };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function getInitials(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function loadInitialState(): AppState {
  if (typeof window === "undefined") {
    return initialAppState;
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return initialAppState;
    }

    const parsed = JSON.parse(saved) as Partial<AppState>;
    if (!parsed || !Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) {
      return initialAppState;
    }

    return {
      ...initialAppState,
      ...parsed,
      activeWorkspaceId:
        parsed.workspaces.some(
          (workspace) => workspace.id === parsed.activeWorkspaceId,
        )
          ? (parsed.activeWorkspaceId as string)
          : parsed.workspaces[0].id,
    };
  } catch {
    return initialAppState;
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function SidebarSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-white/8 pt-4 first:border-t-0 first:pt-0">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        {label}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </div>
      {children}
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  active = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center justify-center border px-3 text-sm transition ${
        active
          ? "border-white/18 bg-white/12 text-white"
          : "border-white/10 bg-white/4 text-[var(--foreground)] hover:bg-white/8"
      } disabled:cursor-not-allowed disabled:opacity-45`}
    >
      {children}
    </button>
  );
}

function ToolButton({
  label,
  short,
  onClick,
  active = false,
}: {
  label: string;
  short: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex h-11 w-11 items-center justify-center border text-xs font-medium transition ${
        active
          ? "border-white/20 bg-white/12 text-white"
          : "border-white/10 bg-white/4 text-[var(--muted)] hover:bg-white/8 hover:text-white"
      }`}
    >
      {short}
    </button>
  );
}

function formatItemType(type: BoardItem["type"]) {
  return type === "image" ? "Image" : "Text";
}

export function MoodboardStudio({
  initialUser,
  isSupabaseConfigured,
}: MoodboardStudioProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pointerActionRef = useRef<PointerAction | null>(null);
  const dragDepthRef = useRef(0);

  const [appState, setAppState] = useState<AppState>(loadInitialState);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(initialUser);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [supabase] = useState(() =>
    isSupabaseConfigured ? createSupabaseBrowserClient() : null,
  );

  const deferredWorkspaceQuery = useDeferredValue(workspaceQuery);
  const currentUserName =
    currentUser?.user_metadata?.full_name ??
    currentUser?.user_metadata?.name ??
    currentUser?.email?.split("@")[0] ??
    appState.userName;

  const activeWorkspace =
    appState.workspaces.find(
      (workspace) => workspace.id === appState.activeWorkspaceId,
    ) ?? appState.workspaces[0];

  const selectedItem =
    activeWorkspace.items.find((item) => item.id === appState.selectedItemId) ?? null;

  const filteredWorkspaces = useMemo(() => {
    const query = deferredWorkspaceQuery.trim().toLowerCase();
    if (!query) {
      return appState.workspaces;
    }

    return appState.workspaces.filter((workspace) => {
      return (
        workspace.name.toLowerCase().includes(query) ||
        workspace.description.toLowerCase().includes(query)
      );
    });
  }, [appState.workspaces, deferredWorkspaceQuery]);

  const workspaceImages = activeWorkspace.items.filter(
    (item): item is ImageItem => item.type === "image",
  );
  const workspaceTexts = activeWorkspace.items.filter(
    (item): item is TextItem => item.type === "text",
  );

  const currentBoardLink =
    typeof window === "undefined"
      ? `https://moodboard-studio-ochre.vercel.app/?board=${activeWorkspace.id}`
      : `${window.location.origin}/?board=${activeWorkspace.id}`;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  }, [appState]);

  useEffect(() => {
    setCurrentUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      startTransition(() => {
        setCurrentUser(session?.user ?? null);
        router.refresh();
      });
    });

    return () => subscription.unsubscribe();
  }, [router, supabase]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const action = pointerActionRef.current;
      if (!action) {
        return;
      }

      setAppState((previous) => {
        const workspaces = previous.workspaces.map((workspace) => {
          if (workspace.id !== action.workspaceId) {
            return workspace;
          }

          if (action.type === "pan") {
            return {
              ...workspace,
              view: {
                ...workspace.view,
                panX: action.originPanX + (event.clientX - action.startClientX),
                panY: action.originPanY + (event.clientY - action.startClientY),
              },
            };
          }

          return {
            ...workspace,
            updatedAt: new Date().toISOString(),
            items: workspace.items.map((item) => {
              if (item.id !== action.itemId) {
                return item;
              }

              if (action.type === "move") {
                return {
                  ...item,
                  x: clamp(
                    action.originX + (event.clientX - action.startClientX) / action.zoom,
                    40,
                    BOARD_SIZE.width - action.itemWidth - 40,
                  ),
                  y: clamp(
                    action.originY + (event.clientY - action.startClientY) / action.zoom,
                    40,
                    BOARD_SIZE.height - action.itemHeight - 40,
                  ),
                };
              }

              return {
                ...item,
                width: clamp(
                  action.originWidth + (event.clientX - action.startClientX) / action.zoom,
                  action.minWidth,
                  BOARD_SIZE.width - action.itemX - 40,
                ),
                height: clamp(
                  action.originHeight + (event.clientY - action.startClientY) / action.zoom,
                  action.minHeight,
                  BOARD_SIZE.height - action.itemY - 40,
                ),
              };
            }),
          };
        });

        return { ...previous, workspaces };
      });
    };

    const handlePointerUp = () => {
      pointerActionRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  function patchActiveWorkspace(
    updater: (workspace: Workspace) => Workspace,
    options?: { touchTimestamp?: boolean },
  ) {
    setAppState((previous) => ({
      ...previous,
      workspaces: previous.workspaces.map((workspace) => {
        if (workspace.id !== previous.activeWorkspaceId) {
          return workspace;
        }

        const nextWorkspace = updater(workspace);
        return options?.touchTimestamp === false
          ? nextWorkspace
          : { ...nextWorkspace, updatedAt: new Date().toISOString() };
      }),
    }));
  }

  function patchSelectedItem(updater: (item: BoardItem) => BoardItem) {
    if (!appState.selectedItemId) {
      return;
    }

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      items: workspace.items.map((item) =>
        item.id === appState.selectedItemId ? updater(item) : item,
      ),
    }));
  }

  function getViewportCenter() {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 1200, y: 800 };
    }

    return {
      x: clamp(
        (rect.width / 2 - activeWorkspace.view.panX) / activeWorkspace.view.zoom,
        120,
        BOARD_SIZE.width - 420,
      ),
      y: clamp(
        (rect.height / 2 - activeWorkspace.view.panY) / activeWorkspace.view.zoom,
        120,
        BOARD_SIZE.height - 280,
      ),
    };
  }

  function getWorldPoint(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return getViewportCenter();
    }

    return {
      x: clamp(
        (clientX - rect.left - activeWorkspace.view.panX) / activeWorkspace.view.zoom,
        40,
        BOARD_SIZE.width - 280,
      ),
      y: clamp(
        (clientY - rect.top - activeWorkspace.view.panY) / activeWorkspace.view.zoom,
        40,
        BOARD_SIZE.height - 180,
      ),
    };
  }

  function addTextAtCenter(point = getViewportCenter()) {
    const id = createId("text");

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      items: [
        ...workspace.items,
        {
          id,
          type: "text",
          text: "New note",
          x: point.x - 140,
          y: point.y - 50,
          width: 280,
          height: 100,
          zIndex: workspace.items.length + 1,
          color: "#f3f5f7",
          fontSize: 38,
          weight: 700,
          letterSpacing: -1.1,
          align: "left",
        },
      ],
    }));

    setAppState((previous) => ({ ...previous, selectedItemId: id }));
  }

  function removeSelectedItem() {
    if (!appState.selectedItemId) {
      return;
    }

    const selectedId = appState.selectedItemId;
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      items: workspace.items.filter((item) => item.id !== selectedId),
    }));

    setAppState((previous) => ({ ...previous, selectedItemId: null }));
  }

  function duplicateSelectedItem() {
    if (!selectedItem) {
      return;
    }

    const duplicateId = createId(selectedItem.type);
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      items: [
        ...workspace.items,
        {
          ...selectedItem,
          id: duplicateId,
          x: clamp(selectedItem.x + 56, 40, BOARD_SIZE.width - selectedItem.width - 40),
          y: clamp(selectedItem.y + 56, 40, BOARD_SIZE.height - selectedItem.height - 40),
          zIndex: workspace.items.length + 1,
        },
      ],
    }));

    setAppState((previous) => ({ ...previous, selectedItemId: duplicateId }));
  }

  const handleShortcutKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const isTypingTarget =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable;

    if (isTypingTarget) {
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && appState.selectedItemId) {
      event.preventDefault();
      removeSelectedItem();
    }

    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      addTextAtCenter();
    }

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleShortcutKeyDown);
    return () => window.removeEventListener("keydown", handleShortcutKeyDown);
  }, []);

  function handleWorkspaceSwitch(workspaceId: string) {
    startTransition(() => {
      setAppState((previous) => ({
        ...previous,
        activeWorkspaceId: workspaceId,
        selectedItemId: null,
      }));
    });
  }

  function handleCreateWorkspace() {
    const id = createId("workspace");
    const workspace: Workspace = {
      id,
      name: `Untitled ${appState.workspaces.length + 1}`,
      description: "New board",
      accent: "#c7ccd4",
      shared: false,
      collaborators: [getInitials(currentUserName)],
      updatedAt: new Date().toISOString(),
      view: defaultView,
      items: [
        {
          id: createId("text"),
          type: "text",
          text: "Drop references",
          x: 1080,
          y: 420,
          width: 480,
          height: 140,
          zIndex: 1,
          color: "#f3f5f7",
          fontSize: 54,
          weight: 800,
          letterSpacing: -1.8,
          align: "left",
        },
      ],
    };

    startTransition(() => {
      setAppState((previous) => ({
        ...previous,
        activeWorkspaceId: id,
        selectedItemId: workspace.items[0]?.id ?? null,
        workspaces: [workspace, ...previous.workspaces],
      }));
    });
  }

  async function handleSignIn() {
    if (!supabase) {
      setAuthError(
        "Supabase is not configured yet. Add the project URL and anon key in Vercel first.",
      );
      return;
    }

    setIsAuthLoading(true);
    setAuthError(null);

    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setIsAuthLoading(false);
      setAuthError(error.message);
    }
  }

  async function handleSignOut() {
    if (!supabase) {
      return;
    }

    setIsAuthLoading(true);
    const { error } = await supabase.auth.signOut();
    setIsAuthLoading(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    setCurrentUser(null);
    router.refresh();
  }

  async function handleCopyBoardLink() {
    try {
      await navigator.clipboard.writeText(currentBoardLink);
      setShareNotice("Link copied.");
    } catch {
      setShareNotice(currentBoardLink);
    }
  }

  function handleInviteCollaborator() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      return;
    }

    const nextInitials = getInitials(email.replace(/@.*$/, ""));
    const alreadyIncluded = activeWorkspace.collaborators.includes(nextInitials);

    if (!alreadyIncluded) {
      patchActiveWorkspace((workspace) => ({
        ...workspace,
        shared: true,
        collaborators: [...workspace.collaborators, nextInitials],
      }));
    }

    setInviteEmail("");
    setShareNotice(`Invite prepared for ${email}.`);
  }

  async function insertFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    const acceptedFiles = files.filter((file) => file.type.startsWith("image/"));
    if (acceptedFiles.length === 0) {
      return;
    }

    const center = getViewportCenter();
    const imageSources = await Promise.all(
      acceptedFiles.map(async (file) => ({
        file,
        src: await readFileAsDataUrl(file),
      })),
    );

    const newItems: ImageItem[] = imageSources.map(({ file, src }, index) => ({
      id: createId("image"),
      type: "image",
      src,
      label: file.name.replace(/\.[^.]+$/, ""),
      x: clamp(center.x - 220 + index * 48, 40, BOARD_SIZE.width - 460),
      y: clamp(center.y - 220 + index * 32, 40, BOARD_SIZE.height - 600),
      width: 380,
      height: 480,
      zIndex: activeWorkspace.items.length + index + 1,
      cropX: 0,
      cropY: 0,
      cropScale: 1,
      borderRadius: 8,
      shadow: 28,
    }));

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      items: [...workspace.items, ...newItems],
    }));

    setAppState((previous) => ({
      ...previous,
      selectedItemId: newItems.at(-1)?.id ?? previous.selectedItemId,
    }));
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    await insertFiles(files);
    event.target.value = "";
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("[data-item-id]")) {
      return;
    }

    pointerActionRef.current = {
      type: "pan",
      workspaceId: activeWorkspace.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originPanX: activeWorkspace.view.panX,
      originPanY: activeWorkspace.view.panY,
    };

    setAppState((previous) => ({ ...previous, selectedItemId: null }));
  }

  function handleItemPointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    item: BoardItem,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();

    const target = event.target as HTMLElement;
    const isResizeHandle = target.dataset.handle === "resize";

    pointerActionRef.current = isResizeHandle
      ? {
          type: "resize",
          workspaceId: activeWorkspace.id,
          itemId: item.id,
          startClientX: event.clientX,
          startClientY: event.clientY,
          originWidth: item.width,
          originHeight: item.height,
          zoom: activeWorkspace.view.zoom,
          itemX: item.x,
          itemY: item.y,
          minWidth: item.type === "image" ? 180 : 160,
          minHeight: item.type === "image" ? 220 : 90,
        }
      : {
          type: "move",
          workspaceId: activeWorkspace.id,
          itemId: item.id,
          startClientX: event.clientX,
          startClientY: event.clientY,
          originX: item.x,
          originY: item.y,
          zoom: activeWorkspace.view.zoom,
          itemWidth: item.width,
          itemHeight: item.height,
        };

    setAppState((previous) => ({ ...previous, selectedItemId: item.id }));
  }

  function handleCanvasWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const nextZoom = clamp(
        activeWorkspace.view.zoom * (event.deltaY < 0 ? 1.08 : 0.92),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const worldX =
        (pointerX - activeWorkspace.view.panX) / activeWorkspace.view.zoom;
      const worldY =
        (pointerY - activeWorkspace.view.panY) / activeWorkspace.view.zoom;

      patchActiveWorkspace(
        (workspace) => ({
          ...workspace,
          view: {
            zoom: nextZoom,
            panX: pointerX - worldX * nextZoom,
            panY: pointerY - worldY * nextZoom,
          },
        }),
        { touchTimestamp: false },
      );
      return;
    }

    patchActiveWorkspace(
      (workspace) => ({
        ...workspace,
        view: {
          ...workspace.view,
          panX: workspace.view.panX - event.deltaX,
          panY: workspace.view.panY - event.deltaY,
        },
      }),
      { touchTimestamp: false },
    );
  }

  function updateZoom(nextZoom: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const worldX = (rect.width / 2 - activeWorkspace.view.panX) / activeWorkspace.view.zoom;
    const worldY =
      (rect.height / 2 - activeWorkspace.view.panY) / activeWorkspace.view.zoom;

    patchActiveWorkspace(
      (workspace) => ({
        ...workspace,
        view: {
          zoom: clampedZoom,
          panX: rect.width / 2 - worldX * clampedZoom,
          panY: rect.height / 2 - worldY * clampedZoom,
        },
      }),
      { touchTimestamp: false },
    );
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    void insertFiles(Array.from(event.dataTransfer.files));
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-item-id]")) {
      return;
    }

    addTextAtCenter(getWorldPoint(event.clientX, event.clientY));
  }

  if (!currentUser) {
    return (
      <main className="grid min-h-screen bg-[var(--background)] text-[var(--foreground)] lg:grid-cols-[420px_1fr]">
        <section className="flex items-center justify-center border-b border-white/8 p-8 lg:border-b-0 lg:border-r">
          <div className="w-full max-w-sm">
            <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">
              Muse Board
            </div>
            <h1 className="mt-5 text-4xl font-medium tracking-[-0.07em]">
              Sign in.
            </h1>
            <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
              Shared boards. Quiet UI. Direct canvas editing.
            </p>
            <div className="mt-8 flex gap-3">
              <ActionButton onClick={() => void handleSignIn()} disabled={isAuthLoading}>
                {isAuthLoading ? "Connecting..." : "Continue with Google"}
              </ActionButton>
            </div>
            {authError ? (
              <div className="mt-4 border border-white/10 bg-white/4 px-4 py-3 text-sm text-[var(--foreground)]">
                {authError}
              </div>
            ) : null}
          </div>
        </section>

        <section className="hidden p-6 lg:block">
          <div className="grid h-full grid-rows-[44px_1fr] border border-white/8 bg-[var(--panel-strong)]">
            <div className="flex items-center justify-between border-b border-white/8 px-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
                Editor
              </div>
              <div className="text-xs text-[var(--muted)]">Minimal dark mode</div>
            </div>
            <div className="grid grid-cols-[56px_220px_1fr_280px]">
              <div className="border-r border-white/8 bg-[#0c0f13] p-2">
                <div className="grid gap-2">
                  {["V", "T", "F", "S"].map((tool) => (
                    <div
                      key={tool}
                      className="flex h-10 w-10 items-center justify-center border border-white/8 bg-white/4 text-xs text-[var(--muted)]"
                    >
                      {tool}
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-r border-white/8 bg-[#0f1217] p-3">
                <div className="space-y-2">
                  {["Brand Sprint", "Interior Direction", "Campaign Shoot"].map((name, index) => (
                    <div
                      key={name}
                      className={`border px-3 py-3 text-sm ${
                        index === 0
                          ? "border-white/16 bg-white/8 text-white"
                          : "border-white/8 bg-transparent text-[var(--muted)]"
                      }`}
                    >
                      {name}
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative border-r border-white/8 bg-[#0a0d11]">
                <div className="canvas-grid canvas-dots absolute inset-0" />
                <div className="absolute left-14 top-14 text-5xl font-medium tracking-[-0.07em] text-white">
                  Spring reset
                </div>
                <div className="absolute left-[320px] top-10 h-[340px] w-[250px] overflow-hidden border border-white/10">
                  <img
                    src="https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80"
                    alt="Preview 1"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="absolute left-[620px] top-[180px] h-[220px] w-[170px] overflow-hidden border border-white/10">
                  <img
                    src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80"
                    alt="Preview 2"
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
              <div className="bg-[#0f1217] p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
                  Properties
                </div>
                <div className="mt-4 space-y-2">
                  <div className="h-10 border border-white/8 bg-white/4" />
                  <div className="h-10 border border-white/8 bg-white/4" />
                  <div className="h-10 border border-white/8 bg-white/4" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelection}
      />

      <div className="grid h-full grid-rows-[48px_1fr]">
        <header className="flex items-center justify-between border-b border-white/8 bg-[var(--panel-strong)] px-4">
          <div className="flex items-center gap-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Muse Board
            </div>
            <div className="text-sm text-[var(--muted)]">{activeWorkspace.name}</div>
          </div>

          <div className="flex items-center gap-2">
            <ActionButton onClick={() => fileInputRef.current?.click()}>Upload</ActionButton>
            <ActionButton onClick={() => addTextAtCenter()}>Text</ActionButton>
            <ActionButton onClick={() => setIsShareOpen(true)}>Share</ActionButton>
            <div className="flex h-8 w-8 items-center justify-center border border-white/10 bg-white/6 text-xs font-medium">
              {getInitials(currentUserName)}
            </div>
            <ActionButton onClick={() => void handleSignOut()}>
              {isAuthLoading ? "..." : "Sign out"}
            </ActionButton>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-[56px_232px_minmax(0,1fr)_280px]">
          <aside className="border-r border-white/8 bg-[#0c0f13] p-2">
            <div className="grid gap-2">
              <ToolButton label="Select" short="V" onClick={() => setShareNotice(null)} active />
              <ToolButton label="Text" short="T" onClick={() => addTextAtCenter()} />
              <ToolButton label="Upload" short="F" onClick={() => fileInputRef.current?.click()} />
              <ToolButton
                label="Reset view"
                short="R"
                onClick={() =>
                  patchActiveWorkspace(
                    (workspace) => ({ ...workspace, view: defaultView }),
                    { touchTimestamp: false },
                  )
                }
              />
            </div>
          </aside>

          <aside className="border-r border-white/8 bg-[#0f1217] p-4">
            <SidebarSection label="Boards">
              <div className="space-y-2">
                <input
                  value={workspaceQuery}
                  onChange={(event) => setWorkspaceQuery(event.target.value)}
                  placeholder="Search"
                  className="w-full border border-white/8 bg-white/4 px-3 py-2 text-sm text-white outline-none placeholder:text-white/28"
                />
                <ActionButton onClick={handleCreateWorkspace}>New board</ActionButton>
              </div>
            </SidebarSection>

            <SidebarSection label="List">
              <div className="space-y-1">
                {filteredWorkspaces.map((workspace) => {
                  const isActive = workspace.id === activeWorkspace.id;
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => handleWorkspaceSwitch(workspace.id)}
                      className={`flex w-full items-center justify-between border px-3 py-3 text-left text-sm transition ${
                        isActive
                          ? "border-white/16 bg-white/8 text-white"
                          : "border-transparent bg-transparent text-[var(--muted)] hover:border-white/8 hover:bg-white/4 hover:text-white"
                      }`}
                    >
                      <div>
                        <div>{workspace.name}</div>
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          {formatUpdatedAt(workspace.updatedAt)}
                        </div>
                      </div>
                      <div className="h-2 w-2 bg-white/28" />
                    </button>
                  );
                })}
              </div>
            </SidebarSection>

            <SidebarSection label="Board">
              <div className="space-y-2 text-sm text-[var(--muted)]">
                <div>{activeWorkspace.description}</div>
                <div>{activeWorkspace.items.length} layers</div>
                <div>{activeWorkspace.shared ? "Shared" : "Private"}</div>
              </div>
            </SidebarSection>
          </aside>

          <section className="grid min-h-0 grid-rows-[44px_1fr_34px] bg-[#0a0d11]">
            <div className="flex items-center justify-between border-b border-white/8 px-4 text-sm text-[var(--muted)]">
              <div className="flex items-center gap-3">
                <span>{activeWorkspace.name}</span>
                <span>{activeWorkspace.shared ? "Shared" : "Private"}</span>
              </div>
              <div className="flex items-center gap-2">
                <ActionButton onClick={() => duplicateSelectedItem()} disabled={!selectedItem}>
                  Duplicate
                </ActionButton>
                <ActionButton onClick={() => removeSelectedItem()} disabled={!selectedItem}>
                  Delete
                </ActionButton>
              </div>
            </div>

            <div
              ref={canvasRef}
              onPointerDown={handleCanvasPointerDown}
              onWheel={handleCanvasWheel}
              onDrop={handleDrop}
              onDragOver={(event) => event.preventDefault()}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDoubleClick={handleDoubleClick}
              className="relative min-h-0 overflow-hidden"
            >
              <div className="canvas-grid canvas-dots absolute inset-0" />

              <div
                className="absolute left-0 top-0"
                style={{
                  width: BOARD_SIZE.width,
                  height: BOARD_SIZE.height,
                  transform: `translate(${activeWorkspace.view.panX}px, ${activeWorkspace.view.panY}px) scale(${activeWorkspace.view.zoom})`,
                  transformOrigin: "0 0",
                }}
              >
                {activeWorkspace.items
                  .toSorted((left, right) => left.zIndex - right.zIndex)
                  .map((item) => {
                    const isSelected = item.id === selectedItem?.id;

                    return (
                      <div
                        key={item.id}
                        data-item-id={item.id}
                        onPointerDown={(event) => handleItemPointerDown(event, item)}
                        className="group absolute"
                        style={{
                          left: item.x,
                          top: item.y,
                          width: item.width,
                          height: item.height,
                          cursor: "grab",
                        }}
                      >
                        {item.type === "image" ? (
                          <div
                            className={`relative h-full overflow-hidden border ${
                              isSelected ? "border-[3px] border-white" : "border-white/10"
                            }`}
                            style={{
                              borderRadius: item.borderRadius,
                              boxShadow: `0 ${Math.round(item.shadow / 2)}px ${item.shadow}px rgba(0, 0, 0, 0.34)`,
                            }}
                          >
                            <img
                              src={item.src}
                              alt={item.label}
                              className="pointer-events-none h-full w-full object-cover"
                              style={{
                                transform: `translate(${item.cropX}px, ${item.cropY}px) scale(${item.cropScale})`,
                                transformOrigin: "center",
                              }}
                            />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-3 py-2 text-xs text-white opacity-0 transition group-hover:opacity-100">
                              {item.label}
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`h-full border px-4 py-3 ${
                              isSelected
                                ? "border-[3px] border-white bg-[rgba(16,19,24,0.96)]"
                                : "border-white/8 bg-[rgba(17,21,27,0.88)]"
                            }`}
                          >
                            <div
                              className="h-full whitespace-pre-wrap"
                              style={{
                                color: item.color,
                                fontSize: item.fontSize,
                                fontWeight: item.weight,
                                letterSpacing: `${item.letterSpacing}px`,
                                lineHeight: 0.95,
                                textAlign: item.align,
                              }}
                            >
                              {item.text}
                            </div>
                          </div>
                        )}

                        {isSelected ? (
                          <div
                            data-handle="resize"
                            className="absolute bottom-[-8px] right-[-8px] h-4 w-4 border-2 border-black bg-white"
                          />
                        ) : null}
                      </div>
                    );
                  })}
              </div>

              {isDraggingFiles ? (
                <div className="absolute inset-6 z-30 flex items-center justify-center border border-dashed border-white/16 bg-[rgba(10,13,17,0.94)]">
                  <div className="text-sm text-[var(--muted)]">Drop images</div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between border-t border-white/8 px-4 text-xs text-[var(--muted)]">
              <div className="flex items-center gap-3">
                <span>{Math.round(activeWorkspace.view.zoom * 100)}%</span>
                <span>{workspaceImages.length} images</span>
                <span>{workspaceTexts.length} text</span>
              </div>
              <div className="flex items-center gap-2">
                <ActionButton onClick={() => updateZoom(activeWorkspace.view.zoom - 0.1)}>
                  -
                </ActionButton>
                <ActionButton onClick={() => updateZoom(activeWorkspace.view.zoom + 0.1)}>
                  +
                </ActionButton>
                <ActionButton
                  onClick={() =>
                    patchActiveWorkspace(
                      (workspace) => ({ ...workspace, view: defaultView }),
                      { touchTimestamp: false },
                    )
                  }
                >
                  Reset
                </ActionButton>
              </div>
            </div>
          </section>

          <aside className="border-l border-white/8 bg-[#0f1217] p-4">
            <SidebarSection label="Properties">
              {selectedItem ? (
                <div className="space-y-4">
                  <div className="border border-white/8 bg-white/4 px-3 py-3 text-sm text-[var(--foreground)]">
                    {formatItemType(selectedItem.type)}
                  </div>

                  {selectedItem.type === "text" ? (
                    <>
                      <Field label="Text">
                        <textarea
                          value={selectedItem.text}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "text"
                                ? { ...item, text: event.target.value }
                                : item,
                            )
                          }
                          className="min-h-24 w-full border border-white/8 bg-white/4 px-3 py-3 text-sm text-white outline-none"
                        />
                      </Field>

                      <Field label="Color">
                        <input
                          type="color"
                          value={selectedItem.color}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "text"
                                ? { ...item, color: event.target.value }
                                : item,
                            )
                          }
                          className="h-11 w-full border border-white/8 bg-white/4 p-1"
                        />
                      </Field>

                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Size">
                          <input
                            type="number"
                            value={Math.round(selectedItem.fontSize)}
                            onChange={(event) =>
                              patchSelectedItem((item) =>
                                item.type === "text"
                                  ? { ...item, fontSize: Number(event.target.value) || item.fontSize }
                                  : item,
                              )
                            }
                            className="w-full border border-white/8 bg-white/4 px-3 py-3 text-sm text-white outline-none"
                          />
                        </Field>
                        <Field label="Weight">
                          <input
                            type="number"
                            step={100}
                            value={selectedItem.weight}
                            onChange={(event) =>
                              patchSelectedItem((item) =>
                                item.type === "text"
                                  ? {
                                      ...item,
                                      weight: clamp(
                                        Number(event.target.value) || item.weight,
                                        500,
                                        800,
                                      ) as TextItem["weight"],
                                    }
                                  : item,
                              )
                            }
                            className="w-full border border-white/8 bg-white/4 px-3 py-3 text-sm text-white outline-none"
                          />
                        </Field>
                      </div>
                    </>
                  ) : (
                    <>
                      <Field label="Label">
                        <input
                          value={selectedItem.label}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "image"
                                ? { ...item, label: event.target.value }
                                : item,
                            )
                          }
                          className="w-full border border-white/8 bg-white/4 px-3 py-3 text-sm text-white outline-none"
                        />
                      </Field>

                      <Field label={`Crop X ${Math.round(selectedItem.cropX)}px`}>
                        <input
                          type="range"
                          min={-140}
                          max={140}
                          value={selectedItem.cropX}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "image"
                                ? { ...item, cropX: Number(event.target.value) }
                                : item,
                            )
                          }
                          className="w-full"
                        />
                      </Field>

                      <Field label={`Crop Y ${Math.round(selectedItem.cropY)}px`}>
                        <input
                          type="range"
                          min={-140}
                          max={140}
                          value={selectedItem.cropY}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "image"
                                ? { ...item, cropY: Number(event.target.value) }
                                : item,
                            )
                          }
                          className="w-full"
                        />
                      </Field>

                      <Field label={`Zoom ${selectedItem.cropScale.toFixed(2)}x`}>
                        <input
                          type="range"
                          min={1}
                          max={2.4}
                          step={0.02}
                          value={selectedItem.cropScale}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "image"
                                ? { ...item, cropScale: Number(event.target.value) }
                                : item,
                            )
                          }
                          className="w-full"
                        />
                      </Field>
                    </>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="W">
                      <input
                        type="number"
                        value={Math.round(selectedItem.width)}
                        onChange={(event) =>
                          patchSelectedItem((item) => ({
                            ...item,
                            width: clamp(
                              Number(event.target.value) || item.width,
                              item.type === "image" ? 180 : 160,
                              BOARD_SIZE.width - item.x - 40,
                            ),
                          }))
                        }
                        className="w-full border border-white/8 bg-white/4 px-3 py-3 text-sm text-white outline-none"
                      />
                    </Field>
                    <Field label="H">
                      <input
                        type="number"
                        value={Math.round(selectedItem.height)}
                        onChange={(event) =>
                          patchSelectedItem((item) => ({
                            ...item,
                            height: clamp(
                              Number(event.target.value) || item.height,
                              item.type === "image" ? 220 : 90,
                              BOARD_SIZE.height - item.y - 40,
                            ),
                          }))
                        }
                        className="w-full border border-white/8 bg-white/4 px-3 py-3 text-sm text-white outline-none"
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-sm text-[var(--muted)]">
                  <div className="border border-white/8 bg-white/4 px-3 py-3">
                    Select a layer.
                  </div>
                  <div className="border border-white/8 bg-white/4 px-3 py-3">
                    Images: {workspaceImages.length}
                  </div>
                  <div className="border border-white/8 bg-white/4 px-3 py-3">
                    Text: {workspaceTexts.length}
                  </div>
                </div>
              )}
            </SidebarSection>

            <SidebarSection label="People">
              <div className="space-y-2">
                {activeWorkspace.collaborators.map((person, index) => (
                  <div
                    key={`${person}-${index}`}
                    className="flex items-center justify-between border border-white/8 bg-white/4 px-3 py-3 text-sm"
                  >
                    <span>{person}</span>
                    <span className="text-[var(--muted)]">Edit</span>
                  </div>
                ))}
              </div>
            </SidebarSection>
          </aside>
        </div>
      </div>

      {isShareOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl border border-white/8 bg-[var(--panel-strong)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
                  Share
                </div>
                <div className="mt-2 text-2xl font-medium tracking-[-0.05em]">
                  {activeWorkspace.name}
                </div>
              </div>
              <ActionButton onClick={() => setIsShareOpen(false)}>Close</ActionButton>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-4">
                <Field label="Invite">
                  <div className="flex gap-2">
                    <input
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="name@email.com"
                      className="flex-1 border border-white/8 bg-white/4 px-3 py-3 text-sm text-white outline-none placeholder:text-white/28"
                    />
                    <ActionButton onClick={handleInviteCollaborator}>Invite</ActionButton>
                  </div>
                </Field>

                <Field label="Link">
                  <div className="flex gap-2">
                    <div className="flex-1 truncate border border-white/8 bg-white/4 px-3 py-3 text-sm text-[var(--muted)]">
                      {currentBoardLink}
                    </div>
                    <ActionButton onClick={() => void handleCopyBoardLink()}>
                      Copy
                    </ActionButton>
                  </div>
                </Field>

                {shareNotice ? (
                  <div className="border border-white/8 bg-white/4 px-3 py-3 text-sm">
                    {shareNotice}
                  </div>
                ) : null}
              </div>

              <div className="border border-white/8 bg-white/3 p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                  Access
                </div>
                <div className="mt-3 space-y-2">
                  {activeWorkspace.collaborators.map((person, index) => (
                    <div
                      key={`${person}-${index}`}
                      className="flex items-center justify-between border border-white/8 bg-white/4 px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center border border-white/10 bg-white/6 text-xs font-medium">
                          {person}
                        </div>
                        <div className="text-sm">{person}</div>
                      </div>
                      <div className="text-xs text-[var(--muted)]">Edit</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
