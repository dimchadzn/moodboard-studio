"use client";
/* eslint-disable @next/next/no-img-element */

import { useRouter } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
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
import {
  deleteRemoteBoard,
  fetchRemoteBoards,
  mapBoardRowToWorkspace,
  updateSharedRemoteBoards,
  upsertRemoteBoards,
} from "@/lib/supabase/boards";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";

const STORAGE_KEY = "muse-board-state-v1";
const COLOR_SWATCHES = [
  "#f2efe8",
  "#d6d0c5",
  "#b7aea0",
  "#9a9387",
  "#6f6a61",
  "#ffffff",
  "#0f0f0f",
  "#8f8a83",
] as const;

type MoodboardStudioProps = {
  initialUser: User | null;
  isSupabaseConfigured: boolean;
};

type ToolMode = "select" | "text";
type ResizeHandle = "nw" | "ne" | "sw" | "se";
type SyncStatus = "local" | "syncing" | "synced" | "error";

type ContextMenuState =
  | {
      x: number;
      y: number;
      type: "canvas";
    }
  | {
      x: number;
      y: number;
      type: "item";
      itemId: string;
    }
  | {
      x: number;
      y: number;
      type: "workspace";
      workspaceId: string;
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
      originX: number;
      originY: number;
      originWidth: number;
      originHeight: number;
      handle: ResizeHandle;
      zoom: number;
      minWidth: number;
      minHeight: number;
      aspectRatio: number;
      preserveAspectRatio: boolean;
    }
  | {
      type: "rotate";
      workspaceId: string;
      itemId: string;
      centerClientX: number;
      centerClientY: number;
      originRotation: number;
    };

type IconName =
  | "cursor"
  | "text"
  | "upload"
  | "share"
  | "search"
  | "plus"
  | "trash"
  | "duplicate"
  | "layers"
  | "users"
  | "lock"
  | "globe"
  | "image"
  | "minus"
  | "fit"
  | "rotate"
  | "ellipsis"
  | "check"
  | "close";

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

function normalizeItem(item: BoardItem): BoardItem {
  if (item.type === "image") {
    return {
      ...item,
      rotation: item.rotation ?? 0,
      borderRadius: item.borderRadius ?? 4,
      shadow: item.shadow ?? 18,
      aspectRatioLocked: item.aspectRatioLocked ?? true,
    };
  }

  return {
    ...item,
    rotation: item.rotation ?? 0,
  };
}

function normalizeWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    ownerId: workspace.ownerId ?? null,
    accent: workspace.accent ?? "#d0cbc1",
    collaborators: workspace.collaborators ?? [],
    view: workspace.view ?? defaultView,
    items: workspace.items.map((item) => normalizeItem(item)),
  };
}

function loadInitialState(): AppState {
  if (typeof window === "undefined") {
    return {
      ...initialAppState,
      workspaces: initialAppState.workspaces.map(normalizeWorkspace),
    };
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return {
        ...initialAppState,
        workspaces: initialAppState.workspaces.map(normalizeWorkspace),
      };
    }

    const parsed = JSON.parse(saved) as Partial<AppState>;
    if (!parsed || !Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) {
      return {
        ...initialAppState,
        workspaces: initialAppState.workspaces.map(normalizeWorkspace),
      };
    }

    const normalizedWorkspaces = parsed.workspaces.map((workspace) =>
      normalizeWorkspace(workspace as Workspace),
    );

    return {
      ...initialAppState,
      ...parsed,
      workspaces: normalizedWorkspaces,
      activeWorkspaceId:
        normalizedWorkspaces.some(
          (workspace) => workspace.id === parsed.activeWorkspaceId,
        )
          ? (parsed.activeWorkspaceId as string)
          : normalizedWorkspaces[0].id,
    };
  } catch {
    return {
      ...initialAppState,
      workspaces: initialAppState.workspaces.map(normalizeWorkspace),
    };
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

function readImageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new window.Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || 1,
        height: image.naturalHeight || 1,
      });
    };
    image.onerror = () => resolve({ width: 1, height: 1 });
    image.src = src;
  });
}

function sanitizeHex(value: string, fallback: string) {
  const normalized = value.trim().replace(/[^0-9a-fA-F#]/g, "");
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `#${normalized.toLowerCase()}`;
  }
  return fallback;
}

function createWorkspace(
  count: number,
  collaborator: string,
  ownerId: string | null,
): Workspace {
  return {
    id: createId("workspace"),
    ownerId,
    name: `Untitled ${count + 1}`,
    description: "New board",
    accent: "#d0cbc1",
    shared: false,
    collaborators: [collaborator],
    updatedAt: new Date().toISOString(),
    view: defaultView,
    items: [
      {
        id: createId("text"),
        type: "text",
        text: "Drop references",
        x: 1180,
        y: 460,
        width: 520,
        height: 140,
        zIndex: 1,
        rotation: 0,
        color: "#f2efe8",
        fontSize: 58,
        weight: 800,
        letterSpacing: -1.8,
        align: "left",
      },
    ],
  };
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
    case "fit":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M6 3.8H3.8V6M14 3.8h2.2V6M6 16.2H3.8V14M14 16.2h2.2V14" />
          <path {...strokeProps} d="M6 6h8v8H6z" />
        </svg>
      );
    case "rotate":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M14.7 7a5 5 0 1 0 1.1 4.2M14.7 7V3.8M14.7 7h-3" />
        </svg>
      );
    case "ellipsis":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <circle cx="4.5" cy="10" r="1.5" fill="currentColor" />
          <circle cx="10" cy="10" r="1.5" fill="currentColor" />
          <circle cx="15.5" cy="10" r="1.5" fill="currentColor" />
        </svg>
      );
    case "check":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="m4.5 10.5 3.2 3.1 7.8-7.8" />
        </svg>
      );
    case "close":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M5 5l10 10M15 5 5 15" />
        </svg>
      );
    default:
      return null;
  }
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
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  compact?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-[12px] border px-3 text-sm transition ${
        compact ? "h-9" : "h-10"
      } ${
        danger
          ? "border-white/8 bg-[#161110] text-[#f1c0b2] hover:bg-[#1b1413]"
          : active
            ? "border-white/16 bg-white/[0.10] text-white"
            : "border-white/8 bg-white/[0.03] text-[var(--foreground)] hover:bg-white/[0.06]"
      } disabled:cursor-not-allowed disabled:opacity-45`}
    >
      {children}
    </button>
  );
}

function ToolButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-[12px] border transition ${
        active
          ? "border-white/16 bg-white/[0.10] text-white"
          : "border-white/8 bg-[#111111] text-[var(--muted)] hover:bg-white/[0.06] hover:text-white"
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
  onContextMenu,
}: {
  workspace: Workspace;
  active: boolean;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full border-b px-4 py-3 text-left transition ${
        active
          ? "border-white/10 bg-white/[0.06] text-white"
          : "border-white/6 text-[var(--muted)] hover:bg-white/[0.04] hover:text-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px]">{workspace.name}</div>
          <div className="mt-1 truncate text-[11px] text-[var(--muted)]">
            {workspace.description}
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {workspace.shared ? (
            <Icon name="globe" className="h-3.5 w-3.5 text-[var(--muted)]" />
          ) : (
            <Icon name="lock" className="h-3.5 w-3.5 text-[var(--muted)]" />
          )}
          <div
            className={`h-2.5 w-2.5 rounded-full ${
              active ? "bg-white" : "bg-white/18"
            }`}
          />
        </div>
      </div>
    </button>
  );
}

function ColorPickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <Field label={label}>
      <div className="rounded-[16px] border border-white/8 bg-[#101010] p-3">
        <div className="mb-3 flex items-center gap-2">
          {COLOR_SWATCHES.map((swatch) => {
            const active = swatch.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                onClick={() => onChange(swatch)}
                className={`relative h-8 w-8 rounded-full border ${
                  active ? "border-white/30" : "border-white/10"
                }`}
                style={{ backgroundColor: swatch }}
                title={swatch}
              >
                {active ? (
                  <span className="absolute inset-0 flex items-center justify-center text-black">
                    <Icon name="check" className="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-[12px] border border-white/10"
            style={{ backgroundColor: value }}
          />
          <input
            value={draft.toUpperCase()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              const next = sanitizeHex(draft, value);
              setDraft(next);
              onChange(next);
            }}
            className="h-10 flex-1 rounded-[12px] border border-white/8 bg-[#0c0c0c] px-3 text-sm text-white outline-none"
          />
        </div>
      </div>
    </Field>
  );
}

function MiniMap({
  workspace,
  onFit,
}: {
  workspace: Workspace;
  onFit: () => void;
}) {
  const minimapWidth = 176;
  const minimapHeight = (BOARD_SIZE.height / BOARD_SIZE.width) * minimapWidth;
  const viewportWidth = 1400 / workspace.view.zoom;
  const viewportHeight = 920 / workspace.view.zoom;
  const viewportX = clamp(-workspace.view.panX / workspace.view.zoom, 0, BOARD_SIZE.width);
  const viewportY = clamp(-workspace.view.panY / workspace.view.zoom, 0, BOARD_SIZE.height);

  return (
    <div className="absolute bottom-4 right-4 z-20 hidden rounded-[18px] border border-white/8 bg-[#0d0d0d]/92 p-3 backdrop-blur md:block">
      <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
        <span>Overview</span>
        <button
          type="button"
          onClick={onFit}
          className="text-white transition hover:text-[var(--muted)]"
        >
          Fit
        </button>
      </div>
      <div
        className="relative overflow-hidden rounded-[10px] border border-white/8 bg-[#111111]"
        style={{ width: minimapWidth, height: minimapHeight }}
      >
        {workspace.items.map((item) => (
          <div
            key={item.id}
            className="absolute border border-white/20 bg-white/8"
            style={{
              left: (item.x / BOARD_SIZE.width) * minimapWidth,
              top: (item.y / BOARD_SIZE.height) * minimapHeight,
              width: Math.max(2, (item.width / BOARD_SIZE.width) * minimapWidth),
              height: Math.max(2, (item.height / BOARD_SIZE.height) * minimapHeight),
            }}
          />
        ))}
        <div
          className="absolute border border-white/40"
          style={{
            left: (viewportX / BOARD_SIZE.width) * minimapWidth,
            top: (viewportY / BOARD_SIZE.height) * minimapHeight,
            width: clamp((viewportWidth / BOARD_SIZE.width) * minimapWidth, 18, minimapWidth),
            height: clamp(
              (viewportHeight / BOARD_SIZE.height) * minimapHeight,
              18,
              minimapHeight,
            ),
          }}
        />
      </div>
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
  const ignoreRemoteSaveRef = useRef(false);
  const remoteHydratedRef = useRef(false);
  const remoteChannelRef = useRef<string | null>(null);

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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [syncMessage, setSyncMessage] = useState<string>("Local only");
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

  const currentBoardLink =
    typeof window === "undefined"
      ? `https://moodboard-studio-ochre.vercel.app/?board=${activeWorkspace.id}`
      : `${window.location.origin}/?board=${activeWorkspace.id}`;

  const syncBadgeLabel =
    syncStatus === "syncing"
      ? "Syncing"
      : syncStatus === "synced"
        ? "Synced"
        : syncStatus === "error"
          ? "Sync error"
          : "Local";

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
      return { x: BOARD_SIZE.width / 2, y: BOARD_SIZE.height / 2 };
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

  function getFitView() {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return defaultView;
    }

    const zoom = clamp(
      Math.min((rect.width - 180) / BOARD_SIZE.width, (rect.height - 180) / BOARD_SIZE.height),
      MIN_ZOOM,
      1,
    );

    return {
      zoom,
      panX: (rect.width - BOARD_SIZE.width * zoom) / 2,
      panY: (rect.height - BOARD_SIZE.height * zoom) / 2,
    };
  }

  function fitBoardToView() {
    patchActiveWorkspace(
      (workspace) => ({
        ...workspace,
        view: getFitView(),
      }),
      { touchTimestamp: false },
    );
  }

  function addTextAtPoint(point = getViewportCenter()) {
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
          rotation: 0,
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
          x: clamp(selectedItem.x + 48, 40, BOARD_SIZE.width - selectedItem.width - 40),
          y: clamp(selectedItem.y + 48, 40, BOARD_SIZE.height - selectedItem.height - 40),
          zIndex: workspace.items.length + 1,
        },
      ],
    }));

    setAppState((previous) => ({ ...previous, selectedItemId: duplicateId }));
  }

  function handleWorkspaceSwitch(workspaceId: string) {
    startTransition(() => {
      setAppState((previous) => ({
        ...previous,
        activeWorkspaceId: workspaceId,
        selectedItemId: null,
      }));
    });
    setToolMode("select");
    setContextMenu(null);
  }

  function handleCreateWorkspace() {
    const workspace = createWorkspace(
      appState.workspaces.length,
      getInitials(currentUserName),
      currentUser?.id ?? null,
    );

    startTransition(() => {
      setAppState((previous) => ({
        ...previous,
        activeWorkspaceId: workspace.id,
        selectedItemId: workspace.items[0]?.id ?? null,
        workspaces: [workspace, ...previous.workspaces],
      }));
    });
    setToolMode("select");
  }

  async function handleDeleteWorkspace(workspaceId: string) {
    if (appState.workspaces.length <= 1) {
      setShareNotice("Create another board before deleting the last one.");
      return;
    }

    const workspace = appState.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) {
      return;
    }

    const remaining = appState.workspaces.filter((entry) => entry.id !== workspaceId);
    const nextActiveWorkspaceId =
      appState.activeWorkspaceId === workspaceId
        ? remaining[0]?.id ?? null
        : appState.activeWorkspaceId;

    setAppState((previous) => ({
      ...previous,
      workspaces: previous.workspaces.filter((entry) => entry.id !== workspaceId),
      activeWorkspaceId: nextActiveWorkspaceId ?? previous.workspaces[0].id,
      selectedItemId: null,
    }));

    if (supabase && currentUser && (workspace.ownerId === currentUser.id || !workspace.ownerId)) {
      const { error } = await deleteRemoteBoard(supabase, workspaceId);
      if (error) {
        setSyncStatus("error");
        setSyncMessage("Could not delete the remote board");
      }
    }
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
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      shared: true,
      collaborators: workspace.collaborators.includes(nextInitials)
        ? workspace.collaborators
        : [...workspace.collaborators, nextInitials],
    }));

    setInviteEmail("");
    setShareNotice(`Invite prepared for ${email}.`);
  }

  async function insertFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    try {
      const acceptedFiles = files.filter((file) => file.type.startsWith("image/"));
      if (acceptedFiles.length === 0) {
        setShareNotice("Only image files can be dropped here.");
        return;
      }

      const center = getViewportCenter();
      const imageSources = await Promise.all(
        acceptedFiles.map(async (file) => {
          const src = await readFileAsDataUrl(file);
          const size = await readImageDimensions(src);
          return { file, src, size };
        }),
      );

      const newItems: ImageItem[] = imageSources.map(({ file, src, size }, index) => {
        const aspectRatio = size.width / size.height || 1;
        const targetWidth = clamp(size.width > size.height ? 420 : 320, 220, 480);
        const targetHeight = clamp(targetWidth / aspectRatio, 200, 560);

        return {
          id: createId("image"),
          type: "image",
          src,
          label: file.name.replace(/\.[^.]+$/, ""),
          x: clamp(center.x - 220 + index * 42, 40, BOARD_SIZE.width - 460),
          y: clamp(center.y - 220 + index * 28, 40, BOARD_SIZE.height - 600),
          width: targetWidth,
          height: targetHeight,
          zIndex: activeWorkspace.items.length + index + 1,
          rotation: 0,
          cropX: 0,
          cropY: 0,
          cropScale: 1,
          borderRadius: 4,
          shadow: 18,
          aspectRatioLocked: true,
        };
      });

      patchActiveWorkspace((workspace) => ({
        ...workspace,
        items: [...workspace.items, ...newItems],
      }));

      setAppState((previous) => ({
        ...previous,
        selectedItemId: newItems.at(-1)?.id ?? previous.selectedItemId,
      }));
      setToolMode("select");
      setShareNotice(null);
    } catch {
      setShareNotice("Could not add that image. Try another file.");
    }
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    await insertFiles(files);
    event.target.value = "";
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

  const loadRemoteBoardsIntoState = useEffectEvent(async (client: SupabaseClient, userId: string) => {
    const { data, error } = await fetchRemoteBoards(client, userId);

    if (error) {
      setSyncStatus("error");
      setSyncMessage("Remote sync is configured but the boards table is missing.");
      return;
    }

    const remoteWorkspaces = (data ?? []).map((row) =>
      normalizeWorkspace(mapBoardRowToWorkspace(row)),
    );

    ignoreRemoteSaveRef.current = true;

    setAppState((previous) => {
      if (remoteWorkspaces.length === 0) {
        return {
          ...previous,
          workspaces: previous.workspaces.map((workspace) => ({
            ...workspace,
            ownerId: workspace.ownerId ?? userId,
          })),
        };
      }

      const nextActiveWorkspaceId = remoteWorkspaces.some(
        (workspace) => workspace.id === previous.activeWorkspaceId,
      )
        ? previous.activeWorkspaceId
        : remoteWorkspaces[0].id;

      return {
        ...previous,
        workspaces: remoteWorkspaces,
        activeWorkspaceId: nextActiveWorkspaceId,
        selectedItemId:
          remoteWorkspaces
            .find((workspace) => workspace.id === nextActiveWorkspaceId)
            ?.items.some((item) => item.id === previous.selectedItemId)
            ? previous.selectedItemId
            : null,
      };
    });

    remoteHydratedRef.current = true;
    setSyncStatus("synced");
    setSyncMessage("Boards synced across signed-in users.");

    window.setTimeout(() => {
      ignoreRemoteSaveRef.current = false;
    }, 0);
  });

  useEffect(() => {
    if (!supabase || !currentUser) {
      setSyncStatus("local");
      setSyncMessage("Local draft");
      remoteHydratedRef.current = false;
      return;
    }

    void loadRemoteBoardsIntoState(supabase, currentUser.id);
  }, [currentUser, supabase]);

  useEffect(() => {
    if (!supabase || !currentUser || !remoteHydratedRef.current || ignoreRemoteSaveRef.current) {
      return;
    }

    const handle = window.setTimeout(async () => {
      setSyncStatus("syncing");
      setSyncMessage("Saving changes...");

      const workspaces = appState.workspaces.map((workspace) =>
        normalizeWorkspace({
          ...workspace,
          ownerId: workspace.ownerId ?? currentUser.id,
        }),
      );

      const ownedResult = await upsertRemoteBoards(supabase, workspaces, currentUser.id);
      const sharedResult = await updateSharedRemoteBoards(
        supabase,
        workspaces,
        currentUser.id,
      );

      if (ownedResult.error || sharedResult.error) {
        setSyncStatus("error");
        setSyncMessage("Could not sync this change.");
        return;
      }

      setSyncStatus("synced");
      setSyncMessage("Boards synced across signed-in users.");
    }, 450);

    return () => window.clearTimeout(handle);
  }, [appState.workspaces, currentUser, supabase]);

  useEffect(() => {
    if (!supabase || !currentUser) {
      return;
    }

    const channel = supabase
      .channel(`boards-sync-${currentUser.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "boards",
        },
        () => {
          void loadRemoteBoardsIntoState(supabase, currentUser.id);
        },
      )
      .subscribe();

    remoteChannelRef.current = `boards-sync-${currentUser.id}`;

    return () => {
      void supabase.removeChannel(channel);
      remoteChannelRef.current = null;
    };
  }, [currentUser, supabase]);

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

              if (action.type === "rotate") {
                const angle =
                  Math.atan2(
                    event.clientY - action.centerClientY,
                    event.clientX - action.centerClientX,
                  ) *
                  (180 / Math.PI);

                return {
                  ...item,
                  rotation: angle + 90,
                };
              }

              const deltaX = (event.clientX - action.startClientX) / action.zoom;
              const deltaY = (event.clientY - action.startClientY) / action.zoom;

              const rawWidth =
                action.handle.includes("w")
                  ? action.originWidth - deltaX
                  : action.originWidth + deltaX;
              const rawHeight =
                action.handle.includes("n")
                  ? action.originHeight - deltaY
                  : action.originHeight + deltaY;

              let nextWidth = rawWidth;
              let nextHeight = rawHeight;

              if (action.preserveAspectRatio) {
                const widthFromHeight = rawHeight * action.aspectRatio;
                const widthDominant =
                  Math.abs(rawWidth - action.originWidth) >=
                  Math.abs(widthFromHeight - action.originWidth);

                nextWidth = widthDominant ? rawWidth : widthFromHeight;
                nextHeight = nextWidth / action.aspectRatio;
              }

              nextWidth = clamp(
                nextWidth,
                action.minWidth,
                BOARD_SIZE.width - 40 - action.originX,
              );
              nextHeight = clamp(
                nextHeight,
                action.minHeight,
                BOARD_SIZE.height - 40 - action.originY,
              );

              let nextX = action.originX;
              let nextY = action.originY;

              if (action.handle.includes("w")) {
                nextX = clamp(
                  action.originX + (action.originWidth - nextWidth),
                  40,
                  action.originX + action.originWidth - action.minWidth,
                );
              }

              if (action.handle.includes("n")) {
                nextY = clamp(
                  action.originY + (action.originHeight - nextHeight),
                  40,
                  action.originY + action.originHeight - action.minHeight,
                );
              }

              return {
                ...item,
                x: nextX,
                y: nextY,
                width: nextWidth,
                height: nextHeight,
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

    if (event.key.toLowerCase() === "0") {
      event.preventDefault();
      fitBoardToView();
    }

    if (event.key === "Escape") {
      setIsShareOpen(false);
      setContextMenu(null);
      setToolMode("select");
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleShortcutKeyDown);
    return () => window.removeEventListener("keydown", handleShortcutKeyDown);
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("pointerdown", closeMenu);
    return () => window.removeEventListener("pointerdown", closeMenu);
  }, []);

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("[data-item-id]")) {
      return;
    }

    if (toolMode === "text") {
      addTextAtPoint(getWorldPoint(event.clientX, event.clientY));
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
    setContextMenu(null);

    const target = event.target as HTMLElement;
    const handle = target.dataset.handle as ResizeHandle | "rotate" | undefined;

    if (handle === "rotate") {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      pointerActionRef.current = {
        type: "rotate",
        workspaceId: activeWorkspace.id,
        itemId: item.id,
        centerClientX:
          rect.left +
          activeWorkspace.view.panX +
          (item.x + item.width / 2) * activeWorkspace.view.zoom,
        centerClientY:
          rect.top +
          activeWorkspace.view.panY +
          (item.y + item.height / 2) * activeWorkspace.view.zoom,
        originRotation: item.rotation,
      };
      setAppState((previous) => ({ ...previous, selectedItemId: item.id }));
      return;
    }

    if (handle) {
      pointerActionRef.current = {
        type: "resize",
        workspaceId: activeWorkspace.id,
        itemId: item.id,
        startClientX: event.clientX,
        startClientY: event.clientY,
        originX: item.x,
        originY: item.y,
        originWidth: item.width,
        originHeight: item.height,
        handle,
        zoom: activeWorkspace.view.zoom,
        minWidth: item.type === "image" ? 180 : 160,
        minHeight: item.type === "image" ? 180 : 90,
        aspectRatio: item.width / item.height,
        preserveAspectRatio:
          item.type === "image" ? item.aspectRatioLocked : event.shiftKey,
      };
      setAppState((previous) => ({ ...previous, selectedItemId: item.id }));
      return;
    }

    pointerActionRef.current = {
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

    addTextAtPoint(getWorldPoint(event.clientX, event.clientY));
  }

  function openCanvasMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: "canvas",
    });
  }

  function openItemMenu(event: React.MouseEvent<HTMLDivElement>, itemId: string) {
    event.preventDefault();
    event.stopPropagation();
    setAppState((previous) => ({ ...previous, selectedItemId: itemId }));
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: "item",
      itemId,
    });
  }

  function openWorkspaceMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    workspaceId: string,
  ) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: "workspace",
      workspaceId,
    });
  }

  if (!currentUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4 text-[var(--foreground)]">
        <div className="w-full max-w-[420px] rounded-[28px] border border-white/8 bg-[#0b0b0b] p-8 shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-sm">
            M
          </div>
          <div className="mt-10 text-[42px] font-medium tracking-[-0.08em]">
            Sign in.
          </div>
          <div className="mt-3 max-w-[220px] text-sm leading-6 text-[var(--muted)]">
            Open your boards and keep everything synced.
          </div>
          <div className="mt-8">
            <SurfaceButton onClick={() => void handleSignIn()} disabled={isAuthLoading}>
              {isAuthLoading ? "Connecting..." : "Continue with Google"}
            </SurfaceButton>
          </div>
          {authError ? (
            <div className="mt-4 rounded-[14px] border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-[var(--muted)]">
              {authError}
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#050505] text-[var(--foreground)]">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelection}
      />

      <div className="grid h-full grid-cols-[256px_minmax(0,1fr)_320px] grid-rows-[52px_1fr]">
        <header className="col-span-3 grid grid-cols-[220px_1fr_auto] items-center border-b border-white/8 bg-[#090909] px-4">
          <div className="text-[15px] tracking-[-0.02em]">Muse</div>

          <div className="mx-auto flex w-full max-w-[420px] items-center gap-2 rounded-[14px] border border-white/8 bg-[#111111] px-3 py-2 text-sm text-[var(--muted)]">
            <Icon name="search" className="h-4 w-4" />
            <input
              value={workspaceQuery}
              onChange={(event) => setWorkspaceQuery(event.target.value)}
              placeholder="Search boards"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/24"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden h-9 items-center rounded-[12px] border border-white/8 bg-[#101010] px-3 text-[12px] text-[var(--muted)] md:flex">
              {syncBadgeLabel}
            </div>
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

        <aside className="min-h-0 border-r border-white/8 bg-[#0b0b0b]">
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-4">
            <div className="text-[14px] text-white">Boards</div>
            <button
              type="button"
              onClick={handleCreateWorkspace}
              className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/8 bg-[#111111] text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-white"
            >
              <Icon name="plus" />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto">
            {filteredWorkspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                active={workspace.id === activeWorkspace.id}
                onClick={() => handleWorkspaceSwitch(workspace.id)}
                onContextMenu={(event) => openWorkspaceMenu(event, workspace.id)}
              />
            ))}
          </div>

          <div className="border-t border-white/8 px-4 py-4">
            <div className="text-[12px] text-[var(--muted)]">{formatUpdatedAt(activeWorkspace.updatedAt)}</div>
            <div className="mt-3 flex items-center gap-2">
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

        <section className="grid min-h-0 grid-rows-[48px_1fr_54px] bg-[#070707]">
          <div className="flex items-center justify-between border-b border-white/8 px-4">
            <div className="min-w-0">
              <div className="truncate text-[15px] text-white">{activeWorkspace.name}</div>
              <div className="mt-1 truncate text-[11px] text-[var(--muted)]">
                {activeWorkspace.description}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden h-9 items-center rounded-[12px] border border-white/8 bg-[#101010] px-3 text-[12px] text-[var(--muted)] md:flex">
                {syncMessage}
              </div>
              <SurfaceButton compact onClick={fitBoardToView}>
                <Icon name="fit" className="h-4 w-4" />
                Fit
              </SurfaceButton>
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
            onContextMenu={openCanvasMenu}
            className="relative min-h-0 overflow-hidden select-none bg-[#080808]"
          >
            <div className="canvas-grid canvas-dots absolute inset-0" />

            <div className="absolute left-4 top-4 z-20 flex flex-col gap-2">
              <ToolButton
                icon="cursor"
                label="Select"
                active={toolMode === "select"}
                onClick={() => setToolMode("select")}
              />
              <ToolButton
                icon="text"
                label="Text"
                active={toolMode === "text"}
                onClick={() => setToolMode("text")}
              />
              <ToolButton
                icon="upload"
                label="Upload"
                onClick={() => fileInputRef.current?.click()}
              />
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

            <MiniMap workspace={activeWorkspace} onFit={fitBoardToView} />

            <div
              className="absolute left-0 top-0"
              style={{
                width: BOARD_SIZE.width,
                height: BOARD_SIZE.height,
                transform: `translate(${activeWorkspace.view.panX}px, ${activeWorkspace.view.panY}px) scale(${activeWorkspace.view.zoom})`,
                transformOrigin: "0 0",
              }}
            >
              <div
                className="absolute left-0 top-0 border border-white/8 bg-[#0d0d0d] shadow-[0_40px_120px_rgba(0,0,0,0.35)]"
                style={{
                  width: BOARD_SIZE.width,
                  height: BOARD_SIZE.height,
                }}
              />

              <div className="pointer-events-none absolute left-8 top-8 text-[11px] uppercase tracking-[0.22em] text-white/14">
                Board
              </div>

              {activeWorkspace.items
                .toSorted((left, right) => left.zIndex - right.zIndex)
                .map((item) => {
                  const isSelected = item.id === selectedItem?.id;

                  return (
                    <div
                      key={item.id}
                      data-item-id={item.id}
                      onPointerDown={(event) => handleItemPointerDown(event, item)}
                      onContextMenu={(event) => openItemMenu(event, item.id)}
                      className="group absolute"
                      style={{
                        left: item.x,
                        top: item.y,
                        width: item.width,
                        height: item.height,
                        transform: `rotate(${item.rotation}deg)`,
                        transformOrigin: "center center",
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
                            className="pointer-events-none h-full w-full select-none object-cover"
                            style={{
                              transform: `translate(${item.cropX}px, ${item.cropY}px) scale(${item.cropScale})`,
                              transformOrigin: "center",
                            }}
                            draggable={false}
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
                            className="h-full whitespace-pre-wrap select-none"
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
                        <>
                          <div
                            data-handle="rotate"
                            className="absolute left-1/2 top-[-28px] h-4 w-4 -translate-x-1/2 rounded-full border border-white/20 bg-[#111111]"
                          />
                          {(["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => (
                            <div
                              key={handle}
                              data-handle={handle}
                              className={`absolute h-3.5 w-3.5 border border-black bg-white ${
                                handle === "nw"
                                  ? "left-[-7px] top-[-7px]"
                                  : handle === "ne"
                                    ? "right-[-7px] top-[-7px]"
                                    : handle === "sw"
                                      ? "bottom-[-7px] left-[-7px]"
                                      : "bottom-[-7px] right-[-7px]"
                              }`}
                            />
                          ))}
                        </>
                      ) : null}
                    </div>
                  );
                })}
            </div>

            {isDraggingFiles ? (
              <div className="absolute inset-5 z-30 flex items-center justify-center border border-dashed border-white/16 bg-black/76">
                <div className="rounded-[16px] border border-white/8 bg-[#111111] px-5 py-3 text-sm text-[var(--muted)]">
                  Drop images anywhere on the board
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
              <SurfaceButton compact onClick={removeSelectedItem} disabled={!selectedItem} danger>
                <Icon name="trash" className="h-4 w-4" />
                Delete
              </SurfaceButton>
            </div>

            <div className="text-[12px] text-[var(--muted)]">
              {toolMode === "text"
                ? "Click to place text"
                : "Drag to move. Scroll to pan. Pinch to zoom. Right click for options."}
            </div>
          </div>
        </section>

        <aside className="min-h-0 border-l border-white/8 bg-[#0b0b0b]">
          <div className="h-full overflow-y-auto px-5 py-5">
            <SectionLabel>{selectedItem ? "Selection" : "Board"}</SectionLabel>

            {selectedItem ? (
              <div className="mt-4 space-y-5">
                <div className="rounded-[16px] border border-white/8 bg-[#101010] px-4 py-3">
                  <div className="text-sm text-white">
                    {selectedItem.type === "image" ? selectedItem.label : "Text layer"}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">
                    {selectedItem.type === "image" ? "Image" : "Text"}
                  </div>
                </div>

                <Field label="Position">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      value={Math.round(selectedItem.x)}
                      onChange={(event) =>
                        patchSelectedItem((item) => ({
                          ...item,
                          x: clamp(Number(event.target.value) || item.x, 40, BOARD_SIZE.width - item.width - 40),
                        }))
                      }
                      className="h-10 rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
                    />
                    <input
                      type="number"
                      value={Math.round(selectedItem.y)}
                      onChange={(event) =>
                        patchSelectedItem((item) => ({
                          ...item,
                          y: clamp(Number(event.target.value) || item.y, 40, BOARD_SIZE.height - item.height - 40),
                        }))
                      }
                      className="h-10 rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
                    />
                  </div>
                </Field>

                <Field label="Size">
                  <div className="grid grid-cols-2 gap-3">
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
                      className="h-10 rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
                    />
                    <input
                      type="number"
                      value={Math.round(selectedItem.height)}
                      onChange={(event) =>
                        patchSelectedItem((item) => ({
                          ...item,
                          height: clamp(
                            Number(event.target.value) || item.height,
                            item.type === "image" ? 180 : 90,
                            BOARD_SIZE.height - item.y - 40,
                          ),
                        }))
                      }
                      className="h-10 rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
                    />
                  </div>
                </Field>

                <Field label="Rotation">
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={selectedItem.rotation}
                    onChange={(event) =>
                      patchSelectedItem((item) => ({
                        ...item,
                        rotation: Number(event.target.value),
                      }))
                    }
                    className="w-full"
                  />
                </Field>

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
                        className="min-h-28 w-full rounded-[14px] border border-white/8 bg-[#101010] px-3 py-3 text-sm text-white outline-none"
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
                          className="h-10 w-full rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
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
                          className="h-10 w-full rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
                        />
                      </Field>
                    </div>

                    <Field label="Letter spacing">
                      <input
                        type="range"
                        min={-4}
                        max={4}
                        step={0.1}
                        value={selectedItem.letterSpacing}
                        onChange={(event) =>
                          patchSelectedItem((item) =>
                            item.type === "text"
                              ? { ...item, letterSpacing: Number(event.target.value) }
                              : item,
                          )
                        }
                        className="w-full"
                      />
                    </Field>

                    <ColorPickerField
                      label="Color"
                      value={selectedItem.color}
                      onChange={(color) =>
                        patchSelectedItem((item) =>
                          item.type === "text" ? { ...item, color } : item,
                        )
                      }
                    />

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
                        className="h-10 w-full rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
                      />
                    </Field>

                    <Field label="Aspect ratio">
                      <SurfaceButton
                        onClick={() =>
                          patchSelectedItem((item) =>
                            item.type === "image"
                              ? { ...item, aspectRatioLocked: !item.aspectRatioLocked }
                              : item,
                          )
                        }
                        active={selectedItem.aspectRatioLocked}
                      >
                        <Icon
                          name={selectedItem.aspectRatioLocked ? "lock" : "globe"}
                          className="h-4 w-4"
                        />
                        {selectedItem.aspectRatioLocked ? "Locked" : "Unlocked"}
                      </SurfaceButton>
                    </Field>

                    <Field label={`Crop X ${Math.round(selectedItem.cropX)}px`}>
                      <input
                        type="range"
                        min={-180}
                        max={180}
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
                        min={-180}
                        max={180}
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

                    <Field label={`Crop Zoom ${selectedItem.cropScale.toFixed(2)}x`}>
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
                          className="h-10 w-full rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
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
                          className="h-10 w-full rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
                        />
                      </Field>
                    </div>
                  </>
                )}
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
                    className="h-10 w-full rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
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
                    className="min-h-24 w-full rounded-[14px] border border-white/8 bg-[#101010] px-3 py-3 text-sm text-white outline-none"
                  />
                </Field>

                <ColorPickerField
                  label="Accent"
                  value={activeWorkspace.accent}
                  onChange={(accent) =>
                    patchActiveWorkspace((workspace) => ({
                      ...workspace,
                      accent,
                    }))
                  }
                />

                <Field label="Access">
                  <div className="grid gap-2">
                    <SurfaceButton
                      onClick={() =>
                        patchActiveWorkspace((workspace) => ({
                          ...workspace,
                          shared: !workspace.shared,
                        }))
                      }
                      active={activeWorkspace.shared}
                    >
                      <Icon
                        name={activeWorkspace.shared ? "globe" : "lock"}
                        className="h-4 w-4"
                      />
                      {activeWorkspace.shared ? "Shared board" : "Private board"}
                    </SurfaceButton>
                    <SurfaceButton onClick={fitBoardToView}>
                      <Icon name="fit" className="h-4 w-4" />
                      Fit board
                    </SurfaceButton>
                    <SurfaceButton
                      danger
                      onClick={() => void handleDeleteWorkspace(activeWorkspace.id)}
                    >
                      <Icon name="trash" className="h-4 w-4" />
                      Delete board
                    </SurfaceButton>
                  </div>
                </Field>

                <Field label="Collaborators">
                  <div className="rounded-[16px] border border-white/8 bg-[#101010] px-4 py-4">
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
              </div>
            )}
          </div>
        </aside>
      </div>

      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[220px] overflow-hidden rounded-[16px] border border-white/8 bg-[#101010] py-2 shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenu.type === "canvas" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  addTextAtPoint();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
              >
                <Icon name="text" className="h-4 w-4 text-[var(--muted)]" />
                Add text
              </button>
              <button
                type="button"
                onClick={() => {
                  fileInputRef.current?.click();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
              >
                <Icon name="upload" className="h-4 w-4 text-[var(--muted)]" />
                Upload images
              </button>
              <button
                type="button"
                onClick={() => {
                  fitBoardToView();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
              >
                <Icon name="fit" className="h-4 w-4 text-[var(--muted)]" />
                Fit board
              </button>
              <button
                type="button"
                onClick={() => {
                  handleCreateWorkspace();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
              >
                <Icon name="plus" className="h-4 w-4 text-[var(--muted)]" />
                New board
              </button>
            </>
          ) : null}

          {contextMenu.type === "item" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  duplicateSelectedItem();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
              >
                <Icon name="duplicate" className="h-4 w-4 text-[var(--muted)]" />
                Duplicate layer
              </button>
              <button
                type="button"
                onClick={() => {
                  removeSelectedItem();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[#f1c0b2] transition hover:bg-white/[0.06]"
              >
                <Icon name="trash" className="h-4 w-4 text-[#f1c0b2]" />
                Delete layer
              </button>
            </>
          ) : null}

          {contextMenu.type === "workspace" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  handleWorkspaceSwitch(contextMenu.workspaceId);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
              >
                <Icon name="layers" className="h-4 w-4 text-[var(--muted)]" />
                Open board
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsShareOpen(true);
                  handleWorkspaceSwitch(contextMenu.workspaceId);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
              >
                <Icon name="share" className="h-4 w-4 text-[var(--muted)]" />
                Share board
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteWorkspace(contextMenu.workspaceId);
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[#f1c0b2] transition hover:bg-white/[0.06]"
              >
                <Icon name="trash" className="h-4 w-4 text-[#f1c0b2]" />
                Delete board
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {isShareOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-[760px] overflow-hidden rounded-[24px] border border-white/8 bg-[#0c0c0c] shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
              <div>
                <div className="text-[15px] text-white">{activeWorkspace.name}</div>
                <div className="mt-1 text-[12px] text-[var(--muted)]">Share board</div>
              </div>
              <button
                type="button"
                onClick={() => setIsShareOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/8 bg-[#111111] text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-white"
              >
                <Icon name="close" />
              </button>
            </div>

            <div className="grid gap-0 md:grid-cols-[1.1fr_0.9fr]">
              <div className="border-b border-white/8 p-5 md:border-b-0 md:border-r">
                <Field label="Visibility">
                  <SurfaceButton
                    onClick={() =>
                      patchActiveWorkspace((workspace) => ({
                        ...workspace,
                        shared: !workspace.shared,
                      }))
                    }
                    active={activeWorkspace.shared}
                  >
                    <Icon
                      name={activeWorkspace.shared ? "globe" : "lock"}
                      className="h-4 w-4"
                    />
                    {activeWorkspace.shared ? "Shared with signed-in users" : "Private"}
                  </SurfaceButton>
                </Field>

                <div className="mt-4">
                  <Field label="Invite">
                    <div className="flex gap-2">
                      <input
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="name@email.com"
                        className="flex-1 rounded-[14px] border border-white/8 bg-[#101010] px-3 py-3 text-sm text-white outline-none placeholder:text-white/24"
                      />
                      <SurfaceButton onClick={handleInviteCollaborator}>Invite</SurfaceButton>
                    </div>
                  </Field>
                </div>

                <div className="mt-4">
                  <Field label="Link">
                    <div className="flex gap-2">
                      <div className="flex-1 truncate rounded-[14px] border border-white/8 bg-[#101010] px-3 py-3 text-sm text-[var(--muted)]">
                        {currentBoardLink}
                      </div>
                      <SurfaceButton onClick={() => void handleCopyBoardLink()}>
                        Copy
                      </SurfaceButton>
                    </div>
                  </Field>
                </div>

                {shareNotice ? (
                  <div className="mt-4 rounded-[14px] border border-white/8 bg-[#101010] px-4 py-3 text-sm text-[var(--muted)]">
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
                      className="flex items-center justify-between rounded-[16px] border border-white/8 bg-[#101010] px-4 py-3"
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
