"use client";
/* eslint-disable @next/next/no-img-element */

import { useRouter } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  startTransition,
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

type ClipboardItem = {
  item: BoardItem;
};

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
  | "close"
  | "sidebar"
  | "inspector"
  | "copy"
  | "paste"
  | "reset";

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

function normalizeItem(item: BoardItem): BoardItem {
  if (item.type === "image") {
    return {
      ...item,
      rotation: item.rotation ?? 0,
      originalWidth: item.originalWidth ?? item.width,
      originalHeight: item.originalHeight ?? item.height,
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

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = src;
  });
}

async function optimizeImageAsset(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(objectUrl);
    const dimensions = {
      width: image.naturalWidth || 1,
      height: image.naturalHeight || 1,
    };
    const maxDimension = 1800;
    const largestSide = Math.max(dimensions.width, dimensions.height);
    const scale = Math.min(1, maxDimension / largestSide);
    const width = Math.max(1, Math.round(dimensions.width * scale));
    const height = Math.max(1, Math.round(dimensions.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      return {
        src: await readFileAsDataUrl(file),
        width: dimensions.width,
        height: dimensions.height,
      };
    }

    context.drawImage(image, 0, 0, width, height);

    try {
      return {
        src: canvas.toDataURL("image/webp", 0.88),
        width,
        height,
      };
    } catch {
      return {
        src: canvas.toDataURL("image/jpeg", 0.9),
        width,
        height,
      };
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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

function normalizeRotation(value: number) {
  const normalized = ((value % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

function snapAngle(value: number, increment = 15, threshold = 3) {
  const snapped = Math.round(value / increment) * increment;
  return Math.abs(snapped - value) <= threshold ? snapped : value;
}

function clampViewToBounds(
  view: { panX: number; panY: number; zoom: number },
  rect: { width: number; height: number },
) {
  const extraX = BOARD_SIZE.width * view.zoom;
  const extraY = BOARD_SIZE.height * view.zoom;
  const minPanX = rect.width - BOARD_SIZE.width * view.zoom - extraX;
  const maxPanX = extraX;
  const minPanY = rect.height - BOARD_SIZE.height * view.zoom - extraY;
  const maxPanY = extraY;

  return {
    ...view,
    panX: clamp(view.panX, minPanX, maxPanX),
    panY: clamp(view.panY, minPanY, maxPanY),
  };
}

function autoSizeTextEditor(node: HTMLTextAreaElement | null) {
  if (!node) {
    return;
  }

  node.style.height = "0px";
  node.style.height = `${Math.max(node.scrollHeight, 44)}px`;
}

function getTransferFiles(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return [];
  }

  if (dataTransfer.items.length > 0) {
    return Array.from(dataTransfer.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
  }

  return Array.from(dataTransfer.files);
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
    case "sidebar":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M4 4.5h12v11H4zM8 4.5v11" />
        </svg>
      );
    case "inspector":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M4 4.5h12v11H4zM12 4.5v11" />
        </svg>
      );
    case "copy":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <rect {...strokeProps} x="7" y="7" width="8" height="8" rx="1.5" />
          <path {...strokeProps} d="M5 12.5h-.5A1.5 1.5 0 0 1 3 11V5.5A1.5 1.5 0 0 1 4.5 4H10a1.5 1.5 0 0 1 1.5 1.5V6" />
        </svg>
      );
    case "paste":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M7 5.5H5.5A1.5 1.5 0 0 0 4 7v8.5A1.5 1.5 0 0 0 5.5 17h7A1.5 1.5 0 0 0 14 15.5V14" />
          <path {...strokeProps} d="M9 5h5.5A1.5 1.5 0 0 1 16 6.5v7A1.5 1.5 0 0 1 14.5 15H9" />
          <path {...strokeProps} d="M8 5h4M9 3.8h2A1.2 1.2 0 0 1 12.2 5H7.8A1.2 1.2 0 0 1 9 3.8Z" />
        </svg>
      );
    case "reset":
      return (
        <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
          <path {...strokeProps} d="M15.2 8.2A5.2 5.2 0 1 0 16 11.5M15.2 8.2V4.8M15.2 8.2h-3.4" />
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
      className={`motion-button inline-flex items-center justify-center gap-2 rounded-[12px] border px-3 text-sm ${
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
      className={`motion-button flex h-11 w-11 items-center justify-center rounded-[12px] border ${
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
      className={`motion-button w-full border-b px-4 py-3 text-left ${
        active
          ? "border-white/10 bg-white/[0.06] text-white"
          : "border-white/6 text-[var(--muted)] hover:bg-white/[0.04] hover:text-white"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[14px]">{workspace.name}</div>
        </div>
        <div className="flex items-center gap-2">
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
          <label
            className="relative block h-10 w-10 overflow-hidden rounded-[12px] border border-white/10"
            style={{ backgroundColor: value }}
          >
            <input
              type="color"
              value={sanitizeHex(value, "#f2efe8")}
              onChange={(event) => onChange(event.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
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

export function MoodboardStudio({
  initialUser,
  isSupabaseConfigured,
}: MoodboardStudioProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const editingTextRef = useRef<HTMLTextAreaElement>(null);
  const pointerActionRef = useRef<PointerAction | null>(null);
  const dragDepthRef = useRef(0);
  const ignoreRemoteSaveRef = useRef(false);
  const remoteHydratedRef = useRef(false);

  const [appState, setAppState] = useState<AppState>(loadInitialState);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(initialUser);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [, setSyncStatus] = useState<SyncStatus>("local");
  const [syncMessage, setSyncMessage] = useState<string>("Local only");
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextDraft, setEditingTextDraft] = useState("");
  const [clipboardItem, setClipboardItem] = useState<ClipboardItem | null>(null);
  const [isPointerInteracting, setIsPointerInteracting] = useState(false);
  const [supabase] = useState(() =>
    isSupabaseConfigured ? createSupabaseBrowserClient() : null,
  );
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

  const filteredWorkspaces = useMemo(() => appState.workspaces, [appState.workspaces]);

  const currentBoardLink =
    typeof window === "undefined"
      ? `https://moodboard-studio-ochre.vercel.app/?board=${activeWorkspace.id}`
      : `${window.location.origin}/?board=${activeWorkspace.id}`;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch {
      setShareNotice("This board is too large for browser cache. It stays open, but local draft backup was skipped.");
    }
  }, [appState]);

  useEffect(() => {
    setCurrentUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    if (!editingTextId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const node = editingTextRef.current;
      if (!node) {
        return;
      }
      autoSizeTextEditor(node);
      node.focus();
      const end = node.value.length;
      node.setSelectionRange(end, end);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editingTextId]);

  useEffect(() => {
    if (typeof document === "undefined" || !isPointerInteracting) {
      return;
    }

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [isPointerInteracting]);

  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (profileMenuRef.current && target && !profileMenuRef.current.contains(target)) {
        setIsProfileMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || appState.workspaces.length === 0) {
      return;
    }

    const boardId = new URLSearchParams(window.location.search).get("board");
    if (!boardId) {
      return;
    }

    const match = appState.workspaces.find((workspace) => workspace.id === boardId);
    if (match && match.id !== appState.activeWorkspaceId) {
      setAppState((previous) => ({
        ...previous,
        activeWorkspaceId: match.id,
        selectedItemId: null,
      }));
    }
  }, [appState.activeWorkspaceId, appState.workspaces]);

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

  function startEditingText(itemId: string) {
    const textItem = activeWorkspace.items.find(
      (item): item is TextItem => item.id === itemId && item.type === "text",
    );
    setAppState((previous) => ({ ...previous, selectedItemId: itemId }));
    setEditingTextId(itemId);
    setEditingTextDraft(textItem?.text ?? "");
    setToolMode("select");
  }

  function commitCanvasText(
    itemId: string,
    value: string,
    node?: HTMLTextAreaElement | null,
  ) {
    const nextValue = value.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n");
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      items: workspace.items.map((item) =>
        item.id === itemId && item.type === "text"
          ? {
              ...item,
              text: nextValue.length > 0 ? nextValue : "Text",
              width: node
                ? clamp(Math.ceil(node.scrollWidth), 80, BOARD_SIZE.width - item.x - 40)
                : item.width,
              height: node
                ? clamp(Math.ceil(node.scrollHeight), 44, BOARD_SIZE.height - item.y - 40)
                : item.height,
            }
          : item,
      ),
    }));
  }

  function copySelectedItem() {
    if (!selectedItem) {
      return;
    }
    setClipboardItem({ item: structuredClone(selectedItem) });
  }

  function pasteClipboardItem() {
    if (!clipboardItem) {
      return;
    }

    const baseItem = clipboardItem.item;
    const duplicateId = createId(baseItem.type);
    patchActiveWorkspace((workspace) => ({
      ...workspace,
      items: [
        ...workspace.items,
        {
          ...baseItem,
          id: duplicateId,
          x: clamp(baseItem.x + 56, 40, BOARD_SIZE.width - baseItem.width - 40),
          y: clamp(baseItem.y + 56, 40, BOARD_SIZE.height - baseItem.height - 40),
          zIndex: workspace.items.length + 1,
        },
      ],
    }));

    setAppState((previous) => ({ ...previous, selectedItemId: duplicateId }));
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
      ...clampViewToBounds(
        {
          zoom,
          panX: (rect.width - BOARD_SIZE.width * zoom) / 2,
          panY: (rect.height - BOARD_SIZE.height * zoom) / 2,
        },
        rect,
      ),
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
    setEditingTextId(id);
    setEditingTextDraft("New note");
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
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("board", workspaceId);
      window.history.replaceState({}, "", url);
    }
    setToolMode("select");
    setEditingTextId(null);
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
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("board", workspace.id);
      window.history.replaceState({}, "", url);
    }
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
    if (typeof window !== "undefined" && nextActiveWorkspaceId) {
      const url = new URL(window.location.href);
      url.searchParams.set("board", nextActiveWorkspaceId);
      window.history.replaceState({}, "", url);
    }

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
      const acceptedFiles = files.filter(
        (file) => file.type.startsWith("image/") && file.size > 0,
      );
      if (acceptedFiles.length === 0) {
        setShareNotice("Only image files can be dropped here.");
        return;
      }

      const center = getViewportCenter();
      const imageSources: Array<{
        file: File;
        asset: Awaited<ReturnType<typeof optimizeImageAsset>>;
      }> = [];

      for (const file of acceptedFiles.slice(0, 12)) {
        const asset = await optimizeImageAsset(file);
        imageSources.push({ file, asset });
      }

      const newItems: ImageItem[] = imageSources.map(({ file, asset }, index) => {
        const aspectRatio = asset.width / asset.height || 1;
        const targetWidth = clamp(asset.width > asset.height ? 420 : 320, 220, 480);
        const targetHeight = clamp(targetWidth / aspectRatio, 200, 560);

        return {
          id: createId("image"),
          type: "image",
          src: asset.src,
          label: file.name.replace(/\.[^.]+$/, ""),
          x: clamp(center.x - 220 + index * 42, 40, BOARD_SIZE.width - 460),
          y: clamp(center.y - 220 + index * 28, 40, BOARD_SIZE.height - 600),
          width: targetWidth,
          height: targetHeight,
          zIndex: activeWorkspace.items.length + index + 1,
          rotation: 0,
          originalWidth: targetWidth,
          originalHeight: targetHeight,
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
        view: clampViewToBounds(
          {
            zoom: clampedZoom,
            panX: rect.width / 2 - worldX * clampedZoom,
            panY: rect.height / 2 - worldY * clampedZoom,
          },
          rect,
        ),
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

    if (remoteWorkspaces.length === 0 && appState.workspaces.length > 0) {
      const localBoards = appState.workspaces.map((workspace) =>
        normalizeWorkspace({
          ...workspace,
          ownerId: workspace.ownerId ?? userId,
        }),
      );
      const seeded = await upsertRemoteBoards(client, localBoards, userId);
      if (!seeded.error) {
        const reloaded = await fetchRemoteBoards(client, userId);
        if (!reloaded.error && reloaded.data) {
          ignoreRemoteSaveRef.current = true;
          setAppState((previous) => ({
            ...previous,
            workspaces: reloaded.data.map((row) =>
              normalizeWorkspace(mapBoardRowToWorkspace(row)),
            ),
            activeWorkspaceId:
              reloaded.data.find((row) => row.id === previous.activeWorkspaceId)?.id ??
              reloaded.data[0]?.id ??
              previous.activeWorkspaceId,
          }));
          remoteHydratedRef.current = true;
          setSyncStatus("synced");
          setSyncMessage("Boards synced");
          window.setTimeout(() => {
            ignoreRemoteSaveRef.current = false;
          }, 0);
          return;
        }
      }
    }

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

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUser, supabase]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const action = pointerActionRef.current;
      if (!action) {
        return;
      }

      setAppState((previous) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        const workspaces = previous.workspaces.map((workspace) => {
          if (workspace.id !== action.workspaceId) {
            return workspace;
          }

          if (action.type === "pan") {
            const nextView = {
              ...workspace.view,
              panX: action.originPanX + (event.clientX - action.startClientX),
              panY: action.originPanY + (event.clientY - action.startClientY),
            };
            return {
              ...workspace,
              view: rect ? clampViewToBounds(nextView, rect) : nextView,
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
                const rawAngle =
                  Math.atan2(
                    event.clientY - action.centerClientY,
                    event.clientX - action.centerClientX,
                  ) *
                  (180 / Math.PI);
                const nextRotation = normalizeRotation(
                  event.shiftKey ? rawAngle + 90 : snapAngle(rawAngle + 90),
                );

                return {
                  ...item,
                  rotation: nextRotation,
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
      setIsPointerInteracting(false);
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

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && selectedItem) {
      event.preventDefault();
      copySelectedItem();
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v" && clipboardItem) {
      event.preventDefault();
      pasteClipboardItem();
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && selectedItem) {
      event.preventDefault();
      duplicateSelectedItem();
    }

    if (selectedItem?.type === "text" && event.key === "Enter" && !editingTextId) {
      event.preventDefault();
      startEditingText(selectedItem.id);
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

    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      setLeftPanelOpen((previous) => !previous);
    }

    if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      setRightPanelOpen((previous) => !previous);
    }

    if (event.key.toLowerCase() === "0") {
      event.preventDefault();
      fitBoardToView();
    }

    if (selectedItem && event.key.toLowerCase() === "r") {
      event.preventDefault();
      patchSelectedItem((item) => ({
        ...item,
        rotation: event.shiftKey
          ? normalizeRotation(item.rotation + 15)
          : normalizeRotation(item.rotation - 15),
      }));
    }

    if (selectedItem && event.key.toLowerCase() === "x") {
      event.preventDefault();
      patchSelectedItem((item) => ({ ...item, rotation: 0 }));
    }

    if (selectedItem && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      patchSelectedItem((item) => ({
        ...item,
        x:
          event.key === "ArrowLeft"
            ? clamp(item.x - step, 40, BOARD_SIZE.width - item.width - 40)
            : event.key === "ArrowRight"
              ? clamp(item.x + step, 40, BOARD_SIZE.width - item.width - 40)
              : item.x,
        y:
          event.key === "ArrowUp"
            ? clamp(item.y - step, 40, BOARD_SIZE.height - item.height - 40)
            : event.key === "ArrowDown"
              ? clamp(item.y + step, 40, BOARD_SIZE.height - item.height - 40)
              : item.y,
      }));
    }

    if (event.key === "Escape") {
      setIsShareOpen(false);
      setContextMenu(null);
       setEditingTextId(null);
      setIsProfileMenuOpen(false);
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
    setIsPointerInteracting(true);

    setEditingTextId(null);
    setAppState((previous) => ({ ...previous, selectedItemId: null }));
  }

  function handleItemPointerDown(
    event: React.PointerEvent<HTMLDivElement>,
    item: BoardItem,
  ) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("[data-text-editor='true']")) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    setContextMenu(null);
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
      setIsPointerInteracting(true);
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
      setIsPointerInteracting(true);
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
    setIsPointerInteracting(true);

    setAppState((previous) => ({ ...previous, selectedItemId: item.id }));
    setToolMode("select");
  }

  function handleCanvasWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const nextZoom = clamp(
        activeWorkspace.view.zoom * (event.deltaY < 0 ? 1.08 : 0.9),
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
          view: clampViewToBounds(
            {
              zoom: nextZoom,
              panX: pointerX - worldX * nextZoom,
              panY: pointerY - worldY * nextZoom,
            },
            rect,
          ),
        }),
        { touchTimestamp: false },
      );
      return;
    }

    patchActiveWorkspace(
      (workspace) => ({
        ...workspace,
        view: clampViewToBounds(
          {
            ...workspace.view,
            panX: workspace.view.panX - event.deltaX,
            panY: workspace.view.panY - event.deltaY,
          },
          rect,
        ),
      }),
      { touchTimestamp: false },
    );
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    void insertFiles(getTransferFiles(event.dataTransfer));
  }

  function handleDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }

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
    setEditingTextId(null);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: "canvas",
    });
  }

  function openItemMenu(event: React.MouseEvent<HTMLDivElement>, itemId: string) {
    event.preventDefault();
    event.stopPropagation();
    setEditingTextId(null);
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

      <div
        className="grid h-full transition-[grid-template-columns] duration-300 ease-out"
        style={{
          gridTemplateColumns: `${leftPanelOpen ? "248px" : "0px"} minmax(0,1fr) ${
            rightPanelOpen ? "320px" : "0px"
          }`,
        }}
      >
        <aside
          className={`motion-panel min-h-0 overflow-hidden border-r border-white/8 bg-[#0b0b0b] ${
            leftPanelOpen ? "opacity-100" : "opacity-0"
          }`}
          style={{ transform: leftPanelOpen ? "translateX(0)" : "translateX(-8px)" }}
        >
          <div className="flex h-16 items-center justify-between border-b border-white/8 px-4">
            <div className="text-[14px] text-white">Boards</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreateWorkspace}
                className="motion-button flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/8 bg-[#111111] text-[var(--muted)] hover:bg-white/[0.06] hover:text-white"
              >
                <Icon name="plus" />
              </button>
              <button
                type="button"
                onClick={() => setLeftPanelOpen(false)}
                className="motion-button flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/8 bg-[#111111] text-[var(--muted)] hover:bg-white/[0.06] hover:text-white"
              >
                <Icon name="sidebar" />
              </button>
            </div>
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

          <div ref={profileMenuRef} className="relative border-t border-white/8 px-4 py-4">
            <button
              type="button"
              onClick={() => setIsProfileMenuOpen((previous) => !previous)}
              className="motion-button flex w-full items-center gap-3 rounded-[16px] border border-white/8 bg-[#101010] px-3 py-3 text-left"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-[12px] font-medium">
                {getInitials(currentUserName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{currentUserName}</div>
                <div className="truncate text-[11px] text-[var(--muted)]">{syncMessage}</div>
              </div>
              <Icon name="ellipsis" className="h-4 w-4 text-[var(--muted)]" />
            </button>
            {isProfileMenuOpen ? (
              <div className="motion-pop absolute bottom-[calc(100%+12px)] left-4 w-[220px] overflow-hidden rounded-[16px] border border-white/8 bg-[#101010] py-2 shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
                <button
                  type="button"
                  onClick={() => {
                    setIsShareOpen(true);
                    setIsProfileMenuOpen(false);
                  }}
                  className="motion-button flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white hover:bg-white/[0.06]"
                >
                  <Icon name="share" className="h-4 w-4 text-[var(--muted)]" />
                  Share board
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSignOut();
                    setIsProfileMenuOpen(false);
                  }}
                  className="motion-button flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white hover:bg-white/[0.06]"
                >
                  <Icon name="close" className="h-4 w-4 text-[var(--muted)]" />
                  {isAuthLoading ? "Signing out..." : "Sign out"}
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="relative min-h-0 overflow-hidden bg-[#070707]">
          <div className="absolute left-5 top-5 z-30 max-w-[280px] truncate text-[13px] text-white/92">
            {activeWorkspace.name}
          </div>

          <div
            ref={canvasRef}
            onPointerDown={handleCanvasPointerDown}
            onWheel={handleCanvasWheel}
            onDrop={handleDrop}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDoubleClick={handleDoubleClick}
            onContextMenu={openCanvasMenu}
            className="relative h-full overflow-hidden bg-[#080808] select-none"
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
              <div
                className="absolute left-0 top-0 rounded-[2px] border border-white/10 bg-[#0d0d0d] shadow-[0_40px_120px_rgba(0,0,0,0.36)]"
                style={{
                  width: BOARD_SIZE.width,
                  height: BOARD_SIZE.height,
                }}
              />

              {activeWorkspace.items
                .toSorted((left, right) => left.zIndex - right.zIndex)
                .map((item) => {
                  const isSelected = item.id === selectedItem?.id;
                  const isEditingText = item.type === "text" && editingTextId === item.id;

                  return (
                    <div
                      key={item.id}
                      data-item-id={item.id}
                      onPointerDown={(event) => handleItemPointerDown(event, item)}
                      onContextMenu={(event) => openItemMenu(event, item.id)}
                      onDoubleClick={() => {
                        if (item.type === "text") {
                          startEditingText(item.id);
                        }
                      }}
                      className="motion-item group absolute"
                      style={{
                        left: item.x,
                        top: item.y,
                        width: item.width,
                        height: item.height,
                        transform: `rotate(${item.rotation}deg)`,
                        transformOrigin: "center center",
                        cursor: isEditingText ? "text" : "grab",
                      }}
                    >
                      {item.type === "image" ? (
                        <div
                          className="relative h-full overflow-hidden bg-[#111111]"
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
                        </div>
                      ) : isEditingText ? (
                        <textarea
                          ref={editingTextRef}
                          data-text-editor="true"
                          spellCheck={false}
                          value={editingTextDraft}
                          onPointerDown={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            setEditingTextDraft(event.target.value);
                            autoSizeTextEditor(event.currentTarget);
                          }}
                          onBlur={(event) => {
                            commitCanvasText(item.id, event.currentTarget.value, event.currentTarget);
                            setEditingTextId(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setEditingTextId(null);
                            }
                          }}
                          className="min-h-full w-full resize-none overflow-hidden bg-transparent outline-none"
                          dir="ltr"
                          rows={1}
                          wrap="soft"
                          style={{
                            color: item.color,
                            fontSize: item.fontSize,
                            fontWeight: item.weight,
                            letterSpacing: `${item.letterSpacing}px`,
                            lineHeight: 0.95,
                            textAlign: item.align,
                          }}
                        />
                      ) : (
                        <div
                          className="whitespace-pre-wrap"
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
                      )}

                      {isSelected ? (
                        <>
                          <div className="selection-ring pointer-events-none absolute inset-[-6px] rounded-[10px] border border-white/34 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]" />
                          <div
                            data-handle="rotate"
                            className="selection-handle absolute left-1/2 top-[-52px] flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-white/18 bg-[#101010] text-white shadow-[0_14px_30px_rgba(0,0,0,0.35)]"
                          >
                            <Icon name="rotate" className="pointer-events-none h-[18px] w-[18px]" />
                          </div>
                          {(["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => (
                            <div
                              key={handle}
                              data-handle={handle}
                              className={`selection-handle absolute h-3 w-3 rounded-full border border-[#050505] bg-white ${
                                handle === "nw"
                                  ? "left-[-6px] top-[-6px]"
                                  : handle === "ne"
                                    ? "right-[-6px] top-[-6px]"
                                    : handle === "sw"
                                      ? "bottom-[-6px] left-[-6px]"
                                      : "bottom-[-6px] right-[-6px]"
                              }`}
                            />
                          ))}
                        </>
                      ) : null}
                    </div>
                  );
                })}
            </div>

            <div className="motion-pop absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-[14px] border border-white/8 bg-[#0d0d0d]/92 px-2 py-2 backdrop-blur">
              <ToolButton
                icon="sidebar"
                label="Boards"
                active={leftPanelOpen}
                onClick={() => setLeftPanelOpen((previous) => !previous)}
              />
              <ToolButton
                icon="inspector"
                label="Inspector"
                active={rightPanelOpen}
                onClick={() => setRightPanelOpen((previous) => !previous)}
              />
              <div className="mx-1 h-5 w-px bg-white/8" />
              <button
                type="button"
                onClick={() => updateZoom(activeWorkspace.view.zoom - 0.1)}
                className="motion-button flex h-8 w-8 items-center justify-center rounded-[10px] text-[var(--muted)] hover:bg-white/[0.06] hover:text-white"
              >
                <Icon name="minus" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={fitBoardToView}
                className="motion-button min-w-[56px] rounded-[10px] px-2 text-[12px] text-[var(--muted)] hover:text-white"
              >
                {Math.round(activeWorkspace.view.zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => updateZoom(activeWorkspace.view.zoom + 0.1)}
                className="motion-button flex h-8 w-8 items-center justify-center rounded-[10px] text-[var(--muted)] hover:bg-white/[0.06] hover:text-white"
              >
                <Icon name="plus" className="h-4 w-4" />
              </button>
              <div className="mx-1 h-5 w-px bg-white/8" />
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
              <ToolButton
                icon="share"
                label="Share"
                onClick={() => setIsShareOpen(true)}
              />
            </div>

            {isDraggingFiles ? (
              <div className="absolute inset-5 z-30 flex items-center justify-center border border-dashed border-white/16 bg-black/76">
                <div className="motion-pop rounded-[16px] border border-white/8 bg-[#111111] px-5 py-3 text-sm text-[var(--muted)]">
                  Drop images
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside
          className={`motion-panel min-h-0 overflow-hidden border-l border-white/8 bg-[#0b0b0b] ${
            rightPanelOpen ? "opacity-100" : "opacity-0"
          }`}
          style={{ transform: rightPanelOpen ? "translateX(0)" : "translateX(8px)" }}
        >
          <div className="flex h-16 items-center justify-between border-b border-white/8 px-5">
            <div className="text-[13px] text-white">
              {selectedItem ? "Inspector" : "Board"}
            </div>
            <button
              type="button"
              onClick={() => setRightPanelOpen(false)}
              className="motion-button flex h-9 w-9 items-center justify-center rounded-[12px] text-[var(--muted)] hover:bg-white/[0.06] hover:text-white"
            >
              <Icon name="inspector" />
            </button>
          </div>

          <div className="h-[calc(100%-4rem)] overflow-y-auto px-5 py-5">
            {selectedItem ? (
              <div className="space-y-5">
                <div className="rounded-[16px] border border-white/8 bg-[#101010] px-4 py-3">
                  <div className="truncate text-sm text-white">
                    {selectedItem.type === "image" ? selectedItem.label : selectedItem.text.split("\n")[0] || "Text"}
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
                            item.type === "image" ? 180 : 120,
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
                            item.type === "image" ? 120 : 44,
                            BOARD_SIZE.height - item.y - 40,
                          ),
                        }))
                      }
                      className="h-10 rounded-[12px] border border-white/8 bg-[#101010] px-3 text-sm text-white outline-none"
                    />
                  </div>
                </Field>

                <Field label="Rotation">
                  <div className="space-y-3">
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      value={selectedItem.rotation}
                      onChange={(event) =>
                        patchSelectedItem((item) => ({
                          ...item,
                          rotation: normalizeRotation(Number(event.target.value)),
                        }))
                      }
                      className="w-full"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <SurfaceButton
                        compact
                        onClick={() =>
                          patchSelectedItem((item) => ({
                            ...item,
                            rotation: normalizeRotation(item.rotation - 90),
                          }))
                        }
                      >
                        -90
                      </SurfaceButton>
                      <SurfaceButton compact onClick={() => patchSelectedItem((item) => ({ ...item, rotation: 0 }))}>
                        Reset
                      </SurfaceButton>
                      <SurfaceButton
                        compact
                        onClick={() =>
                          patchSelectedItem((item) => ({
                            ...item,
                            rotation: normalizeRotation(item.rotation + 90),
                          }))
                        }
                      >
                        +90
                      </SurfaceButton>
                    </div>
                  </div>
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
                        className="min-h-32 w-full rounded-[14px] border border-white/8 bg-[#101010] px-3 py-3 text-sm text-white outline-none"
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

                    <Field label="Spacing">
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

                    <Field label="Crop">
                      <div className="grid gap-3">
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
                      </div>
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

                    <div className="grid gap-2">
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
                        <Icon name="lock" className="h-4 w-4" />
                        Lock aspect ratio
                      </SurfaceButton>
                      <SurfaceButton
                        onClick={() =>
                          patchSelectedItem((item) =>
                            item.type === "image"
                              ? {
                                  ...item,
                                  width: item.originalWidth,
                                  height: item.originalHeight,
                                }
                              : item,
                          )
                        }
                      >
                        <Icon name="reset" className="h-4 w-4" />
                        Reset original ratio
                      </SurfaceButton>
                      <SurfaceButton
                        onClick={() =>
                          patchSelectedItem((item) =>
                            item.type === "image"
                              ? { ...item, cropX: 0, cropY: 0, cropScale: 1 }
                              : item,
                          )
                        }
                      >
                        <Icon name="fit" className="h-4 w-4" />
                        Reset crop
                      </SurfaceButton>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-5">
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
                    {activeWorkspace.shared ? "Shared" : "Private"}
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
              </div>
            )}
          </div>
        </aside>
      </div>

      {contextMenu ? (
        <div
          className="motion-pop fixed z-50 min-w-[220px] overflow-hidden rounded-[16px] border border-white/8 bg-[#101010] py-2 shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
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
              {clipboardItem ? (
                <button
                  type="button"
                  onClick={() => {
                    pasteClipboardItem();
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
                >
                  <Icon name="paste" className="h-4 w-4 text-[var(--muted)]" />
                  Paste
                </button>
              ) : null}
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
                  copySelectedItem();
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
              >
                <Icon name="copy" className="h-4 w-4 text-[var(--muted)]" />
                Copy layer
              </button>
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
                  patchSelectedItem((item) => ({ ...item, rotation: 0 }));
                  setContextMenu(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-white transition hover:bg-white/[0.06]"
              >
                <Icon name="reset" className="h-4 w-4 text-[var(--muted)]" />
                Reset rotation
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
          <div className="motion-pop w-full max-w-[760px] overflow-hidden rounded-[24px] border border-white/8 bg-[#0c0c0c] shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
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
