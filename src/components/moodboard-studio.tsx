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

type ToolMode = "select" | "text";

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

type IconName =
  | "cursor"
  | "text"
  | "upload"
  | "share"
  | "search"
  | "plus"
  | "refresh"
  | "trash"
  | "duplicate"
  | "layers"
  | "users"
  | "lock"
  | "globe"
  | "image"
  | "minus";

const TOOLBAR_ITEMS = [
  { key: "select" as const, label: "Select", icon: "cursor" as const },
  { key: "text" as const, label: "Text", icon: "text" as const },
];

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

function Icon({
  name,
  className = "h-4 w-4",
}: {
  name: IconName;
  className?: string;
}) {
  const strokeProps = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.75,
  };

  switch (name) {
    case "cursor":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M4 3.5v12.5l3.4-4 3 5 2.1-1.2-3-5 5-.6z" />
        </svg>
      );
    case "text":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M4 5h12M10 5v10M6.5 15h7" />
        </svg>
      );
    case "upload":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M10 13V4.5M6.8 7.7 10 4.5l3.2 3.2M4 15.5h12" />
        </svg>
      );
    case "share":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M7.2 10.5 12.8 7.3M7.2 9.5l5.6 3.2" />
          <circle {...strokeProps} cx="5" cy="10" r="2.1" />
          <circle {...strokeProps} cx="15" cy="6" r="2.1" />
          <circle {...strokeProps} cx="15" cy="14" r="2.1" />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <circle {...strokeProps} cx="8.5" cy="8.5" r="4.5" />
          <path {...strokeProps} d="m12 12 4 4" />
        </svg>
      );
    case "plus":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M10 4v12M4 10h12" />
        </svg>
      );
    case "refresh":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M15.5 8a5.5 5.5 0 1 0 1 4.8M15.5 8V4.5M15.5 8H12" />
        </svg>
      );
    case "trash":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M5.5 6.5h9M8 6.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M7 6.5v8m6-8v8M6 6.5l.6 9a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-9" />
        </svg>
      );
    case "duplicate":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <rect {...strokeProps} x="7" y="7" width="8" height="8" rx="1.5" />
          <path {...strokeProps} d="M5 12.5h-.5A1.5 1.5 0 0 1 3 11V5.5A1.5 1.5 0 0 1 4.5 4H10a1.5 1.5 0 0 1 1.5 1.5V6" />
        </svg>
      );
    case "layers":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="m10 4 6 3.5-6 3.5-6-3.5zM4 10.5 10 14l6-3.5M4 13.5 10 17l6-3.5" />
        </svg>
      );
    case "users":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <circle {...strokeProps} cx="7" cy="7" r="2.5" />
          <circle {...strokeProps} cx="13.5" cy="8" r="2" />
          <path {...strokeProps} d="M3.5 15c.5-2 2.2-3.2 4.5-3.2s4 1.2 4.5 3.2M12 15c.3-1.4 1.5-2.4 3.3-2.7" />
        </svg>
      );
    case "lock":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <rect {...strokeProps} x="5.2" y="9" width="9.6" height="7" rx="1.5" />
          <path {...strokeProps} d="M7 9V7.2A3 3 0 0 1 10 4.3a3 3 0 0 1 3 2.9V9" />
        </svg>
      );
    case "globe":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <circle {...strokeProps} cx="10" cy="10" r="6.5" />
          <path {...strokeProps} d="M3.8 10h12.4M10 3.5c1.8 1.8 2.7 4 2.7 6.5S11.8 14.7 10 16.5M10 3.5c-1.8 1.8-2.7 4-2.7 6.5S8.2 14.7 10 16.5" />
        </svg>
      );
    case "image":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <rect {...strokeProps} x="3.5" y="4" width="13" height="11.5" rx="1.5" />
          <circle {...strokeProps} cx="8" cy="8" r="1.2" />
          <path {...strokeProps} d="m5.5 13.5 3.4-3.3 2.6 2.3 1.7-1.7 1.3 1.4" />
        </svg>
      );
    case "minus":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M4 10h12" />
        </svg>
      );
    default:
      return null;
  }
}

function WindowDot({ tone }: { tone: "red" | "amber" | "green" }) {
  const background =
    tone === "red" ? "#ff5f57" : tone === "amber" ? "#ffbd2e" : "#28c840";
  return <span className="h-3 w-3 rounded-full" style={{ backgroundColor: background }} />;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
      {children}
    </div>
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
      <div className="mb-2 text-[11px] text-[var(--muted)]">{label}</div>
      {children}
    </label>
  );
}

function SurfaceButton({
  children,
  onClick,
  disabled,
  active = false,
  compact = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-[12px] border px-3 text-sm transition ${
        compact ? "h-9" : "h-10"
      } ${
        active
          ? "border-white/16 bg-white/[0.10] text-white"
          : "border-white/8 bg-white/[0.03] text-[var(--foreground)] hover:bg-white/[0.06]"
      } disabled:cursor-not-allowed disabled:opacity-45`}
    >
      {children}
    </button>
  );
}

function ToolButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: IconName;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-[14px] border transition ${
        active
          ? "border-white/16 bg-white/[0.10] text-white"
          : "border-white/8 bg-[#0f0f0f] text-[var(--muted)] hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      <Icon name={icon} />
    </button>
  );
}

function WorkspaceRow({
  workspace,
  active,
  onClick,
}: {
  workspace: Workspace;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-b px-4 py-3 text-left transition ${
        active
          ? "border-white/10 bg-white/[0.06] text-white"
          : "border-white/6 text-[var(--muted)] hover:bg-white/[0.04] hover:text-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px]">{workspace.name}</div>
          <div className="mt-1 truncate text-[11px] text-[var(--muted)]">
            {workspace.description}
          </div>
        </div>
        <div
          className={`h-2.5 w-2.5 rounded-full ${
            active ? "bg-white" : "bg-white/20"
          }`}
        />
      </div>
    </button>
  );
}

function StatPill({
  icon,
  children,
}: {
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-white/8 bg-[#101010] px-3 text-[12px] text-[var(--muted)]">
      <Icon name={icon} className="h-3.5 w-3.5" />
      <span>{children}</span>
    </div>
  );
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
  const [toolMode, setToolMode] = useState<ToolMode>("select");
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
          color: "#f2efe8",
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
      setToolMode("text");
    }

    if (event.key.toLowerCase() === "v") {
      event.preventDefault();
      setToolMode("select");
    }

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fileInputRef.current?.click();
    }

    if (event.key === "Escape") {
      setIsShareOpen(false);
      setToolMode("select");
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
    setToolMode("select");
  }

  function handleCreateWorkspace() {
    const id = createId("workspace");
    const workspace: Workspace = {
      id,
      name: `Untitled ${appState.workspaces.length + 1}`,
      description: "New board",
      accent: "#d5d0c6",
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
          color: "#f2efe8",
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
    setToolMode("select");
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
      borderRadius: 4,
      shadow: 18,
    }));

    patchActiveWorkspace((workspace) => ({
      ...workspace,
      items: [...workspace.items, ...newItems],
    }));

    setAppState((previous) => ({
      ...previous,
      selectedItemId: newItems.at(-1)?.id ?? previous.selectedItemId,
    }));
    setToolMode("select");
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

    if (toolMode === "text") {
      addTextAtCenter(getWorldPoint(event.clientX, event.clientY));
      setToolMode("select");
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
    setToolMode("select");
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
    setToolMode("select");
  }

  function resetView() {
    patchActiveWorkspace(
      (workspace) => ({ ...workspace, view: defaultView }),
      { touchTimestamp: false },
    );
  }

  const authPreviewWorkspace = appState.workspaces[0];

  if (!currentUser) {
    return (
      <main className="min-h-screen bg-[#050505] p-4 text-[var(--foreground)] md:p-6">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[1520px] items-center justify-center">
          <div className="grid w-full max-w-[1380px] overflow-hidden rounded-[30px] border border-white/8 bg-[#0b0b0b] shadow-[0_40px_120px_rgba(0,0,0,0.55)] lg:grid-cols-[360px_1fr]">
            <section className="flex min-h-[720px] flex-col justify-between border-b border-white/8 p-8 lg:border-b-0 lg:border-r">
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-sm">
                    M
                  </div>
                  <div className="text-[15px] tracking-[-0.02em]">Muse</div>
                </div>
                <div className="mt-20">
                  <div className="max-w-[220px] text-[40px] font-medium tracking-[-0.08em]">
                    Quiet boards for visual work.
                  </div>
                  <div className="mt-5 max-w-[220px] text-sm leading-6 text-[var(--muted)]">
                    Sign in and open the workspace.
                  </div>
                </div>
                <div className="mt-10 space-y-3">
                  <SurfaceButton onClick={() => void handleSignIn()} disabled={isAuthLoading}>
                    {isAuthLoading ? "Connecting..." : "Continue with Google"}
                  </SurfaceButton>
                  {authError ? (
                    <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-[var(--muted)]">
                      {authError}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-white/8 pt-5 text-[12px] text-[var(--muted)]">
                Shared boards, image drops, text notes, canvas zoom.
              </div>
            </section>

            <section className="hidden min-h-[720px] bg-[#090909] lg:flex lg:flex-col">
              <div className="flex h-14 items-center justify-between border-b border-white/8 px-5">
                <div className="flex items-center gap-2">
                  <WindowDot tone="red" />
                  <WindowDot tone="amber" />
                  <WindowDot tone="green" />
                </div>
                <div className="w-[280px] rounded-[12px] border border-white/8 bg-[#121212] px-3 py-2 text-[12px] text-[var(--muted)]">
                  Search
                </div>
                <div className="text-[12px] text-[var(--muted)]">Preview</div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr_280px]">
                <aside className="border-r border-white/8 bg-[#0d0d0d]">
                  <div className="border-b border-white/8 px-4 py-4">
                    <div className="text-[13px] text-white">Boards</div>
                  </div>
                  <div className="py-2">
                    {appState.workspaces.map((workspace, index) => (
                      <WorkspaceRow
                        key={workspace.id}
                        workspace={workspace}
                        active={index === 0}
                        onClick={() => {}}
                      />
                    ))}
                  </div>
                </aside>

                <div className="relative min-h-0 overflow-hidden bg-[#080808]">
                  <div className="canvas-grid canvas-dots absolute inset-0" />
                  <div className="absolute left-6 top-6 flex flex-col gap-2">
                    {TOOLBAR_ITEMS.map((tool, index) => (
                      <ToolButton
                        key={tool.key}
                        label={tool.label}
                        icon={tool.icon}
                        active={index === 0}
                        onClick={() => {}}
                      />
                    ))}
                    <ToolButton label="Upload" icon="upload" onClick={() => {}} />
                  </div>

                  <div
                    className="absolute left-0 top-0"
                    style={{
                      width: BOARD_SIZE.width,
                      height: BOARD_SIZE.height,
                      transform: "translate(-1480px, -970px) scale(0.33)",
                      transformOrigin: "0 0",
                    }}
                  >
                    {authPreviewWorkspace.items.map((item) => (
                      <div
                        key={item.id}
                        className="absolute"
                        style={{
                          left: item.x,
                          top: item.y,
                          width: item.width,
                          height: item.height,
                        }}
                      >
                        {item.type === "image" ? (
                          <div className="h-full overflow-hidden border border-white/10 bg-[#111111]">
                            <img
                              src={item.src}
                              alt={item.label}
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div
                            className="whitespace-pre-wrap"
                            style={{
                              color: item.color,
                              fontSize: item.fontSize,
                              fontWeight: item.weight,
                              letterSpacing: `${item.letterSpacing}px`,
                              lineHeight: 0.95,
                            }}
                          >
                            {item.text}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <aside className="border-l border-white/8 bg-[#0d0d0d] p-5">
                  <SectionLabel>Selection</SectionLabel>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-[14px] border border-white/8 bg-[#111111] px-4 py-3 text-sm">
                      Image
                    </div>
                    <div className="rounded-[14px] border border-white/8 bg-[#111111] px-4 py-3 text-sm text-[var(--muted)]">
                      Crop
                    </div>
                    <div className="rounded-[14px] border border-white/8 bg-[#111111] px-4 py-3 text-sm text-[var(--muted)]">
                      Size
                    </div>
                  </div>
                </aside>
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#050505] p-3 text-[var(--foreground)] md:p-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelection}
      />

      <div className="mx-auto flex h-[calc(100vh-1.5rem)] max-w-[1620px] flex-col overflow-hidden rounded-[30px] border border-white/8 bg-[#0b0b0b] shadow-[0_40px_120px_rgba(0,0,0,0.58)] md:h-[calc(100vh-2.5rem)]">
        <header className="grid h-14 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-white/8 px-4 md:px-5">
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 md:flex">
              <WindowDot tone="red" />
              <WindowDot tone="amber" />
              <WindowDot tone="green" />
            </div>
            <div className="text-[15px] tracking-[-0.02em]">Muse</div>
          </div>

          <div className="mx-auto flex w-full max-w-[360px] items-center gap-2 rounded-[14px] border border-white/8 bg-[#111111] px-3 py-2 text-sm text-[var(--muted)]">
            <Icon name="search" className="h-4 w-4" />
            <input
              value={workspaceQuery}
              onChange={(event) => setWorkspaceQuery(event.target.value)}
              placeholder="Search boards"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/24"
            />
          </div>

          <div className="flex items-center gap-2">
            <SurfaceButton compact onClick={() => fileInputRef.current?.click()}>
              <Icon name="upload" className="h-4 w-4" />
              Upload
            </SurfaceButton>
            <SurfaceButton compact onClick={() => setIsShareOpen(true)}>
              <Icon name="share" className="h-4 w-4" />
              Share
            </SurfaceButton>
            <div className="hidden items-center gap-3 rounded-[14px] border border-white/8 bg-[#111111] px-3 py-2 md:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[12px] font-medium">
                {getInitials(currentUserName)}
              </div>
              <div className="max-w-[140px] truncate text-[13px] text-[var(--muted)]">
                {currentUserName}
              </div>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[248px_minmax(0,1fr)_310px]">
          <aside className="hidden min-h-0 border-r border-white/8 bg-[#0d0d0d] lg:flex lg:flex-col">
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-4">
              <div>
                <div className="text-[14px] text-white">Boards</div>
                <div className="mt-1 text-[11px] text-[var(--muted)]">
                  {appState.workspaces.length} total
                </div>
              </div>
              <button
                type="button"
                onClick={handleCreateWorkspace}
                className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/8 bg-[#111111] text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-white"
              >
                <Icon name="plus" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredWorkspaces.map((workspace) => (
                <WorkspaceRow
                  key={workspace.id}
                  workspace={workspace}
                  active={workspace.id === activeWorkspace.id}
                  onClick={() => handleWorkspaceSwitch(workspace.id)}
                />
              ))}
            </div>

            <div className="border-t border-white/8 px-4 py-4">
              <div className="flex items-center justify-between text-[12px] text-[var(--muted)]">
                <span>{activeWorkspace.shared ? "Shared" : "Private"}</span>
                <span>{formatUpdatedAt(activeWorkspace.updatedAt)}</span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                {activeWorkspace.collaborators.map((person, index) => (
                  <div
                    key={`${person}-${index}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#111111] text-[11px] text-white"
                  >
                    {person}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="mt-4 text-[12px] text-[var(--muted)] transition hover:text-white"
              >
                {isAuthLoading ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </aside>

          <section className="grid min-h-0 grid-rows-[48px_1fr_54px] bg-[#090909]">
            <div className="flex items-center justify-between border-b border-white/8 px-4">
              <div className="min-w-0">
                <div className="truncate text-[15px] text-white">{activeWorkspace.name}</div>
                <div className="mt-1 truncate text-[11px] text-[var(--muted)]">
                  {activeWorkspace.description}
                </div>
              </div>
              <div className="hidden items-center gap-2 md:flex">
                <StatPill icon={activeWorkspace.shared ? "globe" : "lock"}>
                  {activeWorkspace.shared ? "Shared" : "Private"}
                </StatPill>
                <StatPill icon="users">{activeWorkspace.collaborators.length}</StatPill>
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
              className="relative min-h-0 overflow-hidden bg-[#080808]"
            >
              <div className="canvas-grid canvas-dots absolute inset-0" />

              <div className="absolute left-4 top-4 z-20 flex flex-col gap-2">
                {TOOLBAR_ITEMS.map((tool) => (
                  <ToolButton
                    key={tool.key}
                    label={tool.label}
                    icon={tool.icon}
                    active={toolMode === tool.key}
                    onClick={() => setToolMode(tool.key)}
                  />
                ))}
                <ToolButton
                  label="Upload"
                  icon="upload"
                  onClick={() => fileInputRef.current?.click()}
                />
                <ToolButton label="Reset" icon="refresh" onClick={resetView} />
              </div>

              <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
                <SurfaceButton compact onClick={() => updateZoom(activeWorkspace.view.zoom - 0.1)}>
                  <Icon name="minus" className="h-4 w-4" />
                </SurfaceButton>
                <div className="flex h-9 items-center rounded-[12px] border border-white/8 bg-[#101010] px-3 text-[12px] text-[var(--muted)]">
                  {Math.round(activeWorkspace.view.zoom * 100)}%
                </div>
                <SurfaceButton compact onClick={() => updateZoom(activeWorkspace.view.zoom + 0.1)}>
                  <Icon name="plus" className="h-4 w-4" />
                </SurfaceButton>
              </div>

              <div className="absolute bottom-4 right-4 z-20 hidden items-center gap-2 md:flex">
                <StatPill icon="image">{workspaceImages.length}</StatPill>
                <StatPill icon="text">{workspaceTexts.length}</StatPill>
                <StatPill icon="layers">{activeWorkspace.items.length}</StatPill>
              </div>

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
                              isSelected ? "border-[2px] border-white" : "border-white/10"
                            }`}
                            style={{
                              borderRadius: item.borderRadius,
                              boxShadow: `0 ${Math.round(item.shadow / 2)}px ${item.shadow}px rgba(0, 0, 0, 0.32)`,
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
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2 text-[11px] text-white opacity-0 transition group-hover:opacity-100">
                              {item.label}
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`h-full border px-4 py-3 ${
                              isSelected
                                ? "border-[2px] border-white bg-[#121212]"
                                : "border-white/8 bg-[#101010]"
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
                            className="absolute bottom-[-7px] right-[-7px] h-3.5 w-3.5 border border-black bg-white"
                          />
                        ) : null}
                      </div>
                    );
                  })}
              </div>

              {isDraggingFiles ? (
                <div className="absolute inset-5 z-30 flex items-center justify-center border border-dashed border-white/16 bg-black/76">
                  <div className="rounded-[16px] border border-white/8 bg-[#111111] px-5 py-3 text-sm text-[var(--muted)]">
                    Drop images
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between border-t border-white/8 px-4">
              <div className="flex items-center gap-2">
                <SurfaceButton compact onClick={duplicateSelectedItem} disabled={!selectedItem}>
                  <Icon name="duplicate" className="h-4 w-4" />
                  Duplicate
                </SurfaceButton>
                <SurfaceButton compact onClick={removeSelectedItem} disabled={!selectedItem}>
                  <Icon name="trash" className="h-4 w-4" />
                  Delete
                </SurfaceButton>
              </div>

              <div className="text-[12px] text-[var(--muted)]">
                {toolMode === "text" ? "Click anywhere to place text" : "Drag to move. Scroll to pan. Pinch to zoom."}
              </div>
            </div>
          </section>

          <aside className="hidden min-h-0 border-l border-white/8 bg-[#0d0d0d] lg:block">
            <div className="h-full overflow-y-auto px-5 py-5">
              <SectionLabel>{selectedItem ? "Selection" : "Board"}</SectionLabel>

              {selectedItem ? (
                <div className="mt-4 space-y-5">
                  <div className="rounded-[16px] border border-white/8 bg-[#111111] px-4 py-3 text-sm text-white">
                    {selectedItem.type === "image" ? "Image" : "Text"}
                  </div>

                  {selectedItem.type === "text" ? (
                    <>
                      <Field label="Content">
                        <textarea
                          value={selectedItem.text}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "text"
                                ? { ...item, text: event.target.value }
                                : item,
                            )
                          }
                          className="min-h-28 w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
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
                            className="w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
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
                            className="w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
                          />
                        </Field>
                      </div>

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
                          className="h-11 w-full rounded-[14px] border border-white/8 bg-[#111111] p-1"
                        />
                      </Field>

                      <Field label="Align">
                        <div className="grid grid-cols-2 gap-2">
                          <SurfaceButton
                            onClick={() =>
                              patchSelectedItem((item) =>
                                item.type === "text" ? { ...item, align: "left" } : item,
                              )
                            }
                            active={selectedItem.align === "left"}
                          >
                            Left
                          </SurfaceButton>
                          <SurfaceButton
                            onClick={() =>
                              patchSelectedItem((item) =>
                                item.type === "text" ? { ...item, align: "center" } : item,
                              )
                            }
                            active={selectedItem.align === "center"}
                          >
                            Center
                          </SurfaceButton>
                        </div>
                      </Field>
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
                          className="w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
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

                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Radius">
                          <input
                            type="number"
                            value={Math.round(selectedItem.borderRadius)}
                            onChange={(event) =>
                              patchSelectedItem((item) =>
                                item.type === "image"
                                  ? {
                                      ...item,
                                      borderRadius: clamp(
                                        Number(event.target.value) || item.borderRadius,
                                        0,
                                        40,
                                      ),
                                    }
                                  : item,
                              )
                            }
                            className="w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
                          />
                        </Field>
                        <Field label="Shadow">
                          <input
                            type="number"
                            value={Math.round(selectedItem.shadow)}
                            onChange={(event) =>
                              patchSelectedItem((item) =>
                                item.type === "image"
                                  ? {
                                      ...item,
                                      shadow: clamp(
                                        Number(event.target.value) || item.shadow,
                                        0,
                                        80,
                                      ),
                                    }
                                  : item,
                              )
                            }
                            className="w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
                          />
                        </Field>
                      </div>
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
                        className="w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
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
                        className="w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-5">
                  <Field label="Name">
                    <input
                      value={activeWorkspace.name}
                      onChange={(event) =>
                        patchActiveWorkspace((workspace) => ({
                          ...workspace,
                          name: event.target.value,
                        }))
                      }
                      className="w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
                    />
                  </Field>

                  <Field label="Description">
                    <textarea
                      value={activeWorkspace.description}
                      onChange={(event) =>
                        patchActiveWorkspace((workspace) => ({
                          ...workspace,
                          description: event.target.value,
                        }))
                      }
                      className="min-h-24 w-full rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none"
                    />
                  </Field>

                  <Field label="Collaborators">
                    <div className="rounded-[16px] border border-white/8 bg-[#111111] px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        {activeWorkspace.collaborators.map((person, index) => (
                          <div
                            key={`${person}-${index}`}
                            className="flex h-8 items-center justify-center rounded-full border border-white/10 bg-black/30 px-3 text-[11px] text-white"
                          >
                            {person}
                          </div>
                        ))}
                      </div>
                    </div>
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-[16px] border border-white/8 bg-[#111111] px-4 py-4">
                      <div className="text-[11px] text-[var(--muted)]">Images</div>
                      <div className="mt-2 text-2xl tracking-[-0.05em]">{workspaceImages.length}</div>
                    </div>
                    <div className="rounded-[16px] border border-white/8 bg-[#111111] px-4 py-4">
                      <div className="text-[11px] text-[var(--muted)]">Text</div>
                      <div className="mt-2 text-2xl tracking-[-0.05em]">{workspaceTexts.length}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {isShareOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-[720px] overflow-hidden rounded-[26px] border border-white/8 bg-[#0c0c0c] shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
              <div>
                <div className="text-[15px] text-white">{activeWorkspace.name}</div>
                <div className="mt-1 text-[12px] text-[var(--muted)]">Share board</div>
              </div>
              <SurfaceButton compact onClick={() => setIsShareOpen(false)}>
                Close
              </SurfaceButton>
            </div>

            <div className="grid gap-0 md:grid-cols-[1.1fr_0.9fr]">
              <div className="border-b border-white/8 p-5 md:border-b-0 md:border-r">
                <Field label="Invite">
                  <div className="flex gap-2">
                    <input
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="name@email.com"
                      className="flex-1 rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-white outline-none placeholder:text-white/24"
                    />
                    <SurfaceButton onClick={handleInviteCollaborator}>Invite</SurfaceButton>
                  </div>
                </Field>

                <div className="mt-4">
                  <Field label="Link">
                    <div className="flex gap-2">
                      <div className="flex-1 truncate rounded-[14px] border border-white/8 bg-[#111111] px-3 py-3 text-sm text-[var(--muted)]">
                        {currentBoardLink}
                      </div>
                      <SurfaceButton onClick={() => void handleCopyBoardLink()}>
                        Copy
                      </SurfaceButton>
                    </div>
                  </Field>
                </div>

                {shareNotice ? (
                  <div className="mt-4 rounded-[14px] border border-white/8 bg-[#111111] px-4 py-3 text-sm text-[var(--muted)]">
                    {shareNotice}
                  </div>
                ) : null}
              </div>

              <div className="p-5">
                <SectionLabel>Access</SectionLabel>
                <div className="mt-4 space-y-2">
                  {activeWorkspace.collaborators.map((person, index) => (
                    <div
                      key={`${person}-${index}`}
                      className="flex items-center justify-between rounded-[16px] border border-white/8 bg-[#111111] px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/25 text-[11px] text-white">
                          {person}
                        </div>
                        <div className="text-sm text-white">{person}</div>
                      </div>
                      <div className="text-[12px] text-[var(--muted)]">Can edit</div>
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
