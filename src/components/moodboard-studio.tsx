"use client";
/* eslint-disable @next/next/no-img-element */

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

const STORAGE_KEY = "muse-board-state-v1";

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

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function roundNumber(value: number) {
  return Math.round(value * 10) / 10;
}

function ViewerBadge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "muted";
}) {
  const toneClass =
    tone === "accent"
      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
      : tone === "muted"
        ? "bg-black/5 text-[var(--muted)]"
        : "bg-white/70 text-[var(--foreground)]";

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.16em] uppercase ${toneClass}`}
    >
      {children}
    </span>
  );
}

function PanelSection({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-black/8 bg-white/65 p-4 shadow-[0_18px_60px_rgba(55,37,20,0.06)]">
      <div className="mb-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
          {eyebrow}
        </p>
        <h3 className="mt-1 text-sm font-semibold text-[var(--foreground)]">
          {title}
        </h3>
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
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function formatItemType(type: BoardItem["type"]) {
  return type === "image" ? "Image frame" : "Text note";
}

export function MoodboardStudio() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pointerActionRef = useRef<PointerAction | null>(null);
  const dragDepthRef = useRef(0);

  const [appState, setAppState] = useState<AppState>(loadInitialState);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const deferredWorkspaceQuery = useDeferredValue(workspaceQuery);

  const activeWorkspace =
    appState.workspaces.find(
      (workspace) => workspace.id === appState.activeWorkspaceId,
    ) ?? appState.workspaces[0];

  const selectedItem =
    activeWorkspace?.items.find((item) => item.id === appState.selectedItemId) ?? null;

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  }, [appState]);

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
                const nextX = clamp(
                  action.originX + (event.clientX - action.startClientX) / action.zoom,
                  40,
                  BOARD_SIZE.width - action.itemWidth - 40,
                );
                const nextY = clamp(
                  action.originY + (event.clientY - action.startClientY) / action.zoom,
                  40,
                  BOARD_SIZE.height - action.itemHeight - 40,
                );
                return { ...item, x: nextX, y: nextY };
              }

              const nextWidth = clamp(
                action.originWidth + (event.clientX - action.startClientX) / action.zoom,
                action.minWidth,
                BOARD_SIZE.width - action.itemX - 40,
              );
              const nextHeight = clamp(
                action.originHeight + (event.clientY - action.startClientY) / action.zoom,
                action.minHeight,
                BOARD_SIZE.height - action.itemY - 40,
              );

              return {
                ...item,
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
    if (!rect || !activeWorkspace) {
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
    if (!rect || !activeWorkspace) {
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
          x: point.x - 130,
          y: point.y - 55,
          width: 260,
          height: 110,
          zIndex: workspace.items.length + 1,
          color: "#221d17",
          fontSize: 40,
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
          x: clamp(selectedItem.x + 60, 40, BOARD_SIZE.width - selectedItem.width - 40),
          y: clamp(selectedItem.y + 60, 40, BOARD_SIZE.height - selectedItem.height - 40),
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
      name: `Untitled board ${appState.workspaces.length + 1}`,
      description: "Fresh space for a new mood direction.",
      accent: "#6f8b79",
      shared: false,
      collaborators: [getInitials(appState.userName)],
      updatedAt: new Date().toISOString(),
      view: defaultView,
      items: [
        {
          id: createId("text"),
          type: "text",
          text: "Drop references here",
          x: 1120,
          y: 420,
          width: 500,
          height: 160,
          zIndex: 1,
          color: "#393129",
          fontSize: 58,
          weight: 800,
          letterSpacing: -1.9,
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
      x: clamp(center.x - 210 + index * 42, 40, BOARD_SIZE.width - 460),
      y: clamp(center.y - 220 + index * 34, 40, BOARD_SIZE.height - 600),
      width: 380,
      height: 480,
      zIndex: activeWorkspace.items.length + index + 1,
      cropX: 0,
      cropY: 0,
      cropScale: 1,
      borderRadius: 26,
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
    if (!activeWorkspace || event.button !== 0) {
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
    if (!activeWorkspace || event.button !== 0) {
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
    if (!activeWorkspace) {
      return;
    }

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
    if (!activeWorkspace) {
      return;
    }

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

  const workspaceImages = activeWorkspace.items.filter(
    (item): item is ImageItem => item.type === "image",
  );
  const workspaceTexts = activeWorkspace.items.filter(
    (item): item is TextItem => item.type === "text",
  );

  if (!appState.isSignedIn) {
    return (
      <main className="relative flex min-h-screen overflow-hidden px-5 py-6 text-[var(--foreground)] sm:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(212,108,78,0.16),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(94,122,201,0.14),transparent_24%)]" />
        <div className="relative mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[36px] border border-black/8 bg-[rgba(255,251,245,0.8)] p-8 shadow-[0_30px_100px_rgba(74,46,25,0.08)] backdrop-blur md:p-10">
            <ViewerBadge tone="accent">Muse Board</ViewerBadge>
            <h1 className="mt-6 max-w-2xl text-5xl font-extrabold tracking-[-0.06em] sm:text-6xl">
              Build moodboards the way designers actually think.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-[var(--muted)]">
              Drop references, crop them inside frames, add notes, organize separate
              board spaces, and prep the app for synced collaborative boards with
              Google sign-in.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <FeatureStat label="Canvas" value="Unlimited feel" />
              <FeatureStat label="Workspaces" value="Separate board modes" />
              <FeatureStat label="Sharing" value="Realtime-ready" />
            </div>

            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() =>
                  setAppState((previous) => ({ ...previous, isSignedIn: true }))
                }
                className="inline-flex items-center justify-center rounded-full bg-[var(--foreground)] px-6 py-3.5 text-sm font-semibold text-white transition hover:translate-y-[-1px] hover:bg-black"
              >
                Continue with Google
              </button>
              <div className="rounded-full border border-black/8 bg-white/70 px-5 py-3 text-sm text-[var(--muted)]">
                Demo auth now, Supabase Google OAuth next.
              </div>
            </div>

            <div className="mt-10 space-y-3 text-sm text-[var(--muted)]">
              <p>Core interaction thesis:</p>
              <ul className="space-y-2">
                <li>Pan the board by dragging empty space or scrolling.</li>
                <li>Drop images anywhere, then crop them from the inspector.</li>
                <li>Switch workspaces without losing board-specific zoom and pan.</li>
              </ul>
            </div>
          </section>

          <section className="grid gap-5 md:grid-cols-[1.05fr_0.95fr] lg:grid-cols-1">
            <div className="rounded-[36px] border border-black/8 bg-[rgba(255,251,245,0.88)] p-5 shadow-[0_30px_100px_rgba(74,46,25,0.08)] backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <ViewerBadge tone="muted">Shared moodboard</ViewerBadge>
                <span className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  Clean, fast, calm
                </span>
              </div>
              <div className="rounded-[28px] border border-black/8 bg-[#f8f3ea] p-4">
                <div className="grid gap-4 sm:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-[24px] bg-[linear-gradient(180deg,#f3c4ac_0%,#f5eee7_100%)] p-5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-black/55">
                      Brand Sprint
                    </p>
                    <p className="mt-3 max-w-[10ch] text-4xl font-extrabold tracking-[-0.05em]">
                      Spring reset
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-[24px]">
                    <img
                      src="https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80"
                      alt="Interior reference"
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="overflow-hidden rounded-[20px]">
                    <img
                      src="https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=900&q=80"
                      alt="Texture reference"
                      className="h-48 w-full object-cover"
                    />
                  </div>
                  <div className="rounded-[20px] bg-white/75 p-5">
                    <p className="text-sm leading-7 text-[var(--muted)]">
                      Crop the imagery tightly, keep text oversized, and let the board
                      breathe like a poster rather than a dashboard.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[36px] border border-black/8 bg-[rgba(31,27,22,0.94)] p-6 text-white shadow-[0_30px_100px_rgba(74,46,25,0.12)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/60">
                Product direction
              </p>
              <div className="mt-4 space-y-3 text-sm leading-7 text-white/72">
                <p>Local-first editor now, collaboration-ready architecture next.</p>
                <p>
                  The first build focuses on premium interaction feel, clear hierarchy,
                  and the canvas editing flow before we wire backend auth and sync.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col px-4 py-4 text-[var(--foreground)] sm:px-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelection}
      />

      <div className="mb-4 flex items-center justify-between rounded-[28px] border border-black/8 bg-[rgba(255,251,245,0.8)] px-5 py-4 shadow-[0_18px_60px_rgba(55,37,20,0.06)] backdrop-blur">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ViewerBadge tone="accent">Muse Board</ViewerBadge>
            <ViewerBadge tone="muted">Google auth entry in demo mode</ViewerBadge>
          </div>
          <h1 className="mt-2 text-2xl font-extrabold tracking-[-0.04em]">
            Moodboard studio
          </h1>
        </div>

        <div className="flex items-center gap-2 text-right">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
              Sync
            </p>
            <p className="text-sm font-semibold">Local draft saved automatically</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--foreground)] text-sm font-semibold text-white">
            {getInitials(appState.userName)}
          </div>
        </div>
      </div>

      <div className="grid min-h-[calc(100vh-8.75rem)] gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="rounded-[30px] border border-black/8 bg-[rgba(255,251,245,0.78)] p-4 shadow-[0_18px_60px_rgba(55,37,20,0.06)] backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Workspaces
              </p>
              <h2 className="mt-1 text-lg font-semibold">Board collection</h2>
            </div>
            <button
              type="button"
              onClick={handleCreateWorkspace}
              className="rounded-full border border-black/8 bg-white/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition hover:bg-white"
            >
              New
            </button>
          </div>

          <Field label="Find a board">
            <input
              value={workspaceQuery}
              onChange={(event) => setWorkspaceQuery(event.target.value)}
              placeholder="Search by title or mood"
              className="w-full rounded-2xl border border-black/8 bg-white/75 px-4 py-3 text-sm outline-none transition focus:border-black/20"
            />
          </Field>

          <div className="mt-4 space-y-3">
            {filteredWorkspaces.map((workspace) => {
              const isActive = workspace.id === activeWorkspace.id;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => handleWorkspaceSwitch(workspace.id)}
                  className={`w-full rounded-[24px] border p-4 text-left transition ${
                    isActive
                      ? "border-black/10 bg-white shadow-[0_18px_45px_rgba(70,42,20,0.08)]"
                      : "border-transparent bg-white/45 hover:border-black/8 hover:bg-white/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{workspace.name}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                        {workspace.description}
                      </p>
                    </div>
                    <span
                      className="mt-1 h-3 w-3 rounded-full"
                      style={{ backgroundColor: workspace.accent }}
                    />
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs text-[var(--muted)]">
                    <span>{workspace.items.length} layers</span>
                    <span>{formatUpdatedAt(workspace.updatedAt)}</span>
                  </div>
                </button>
              );
            })}

            {filteredWorkspaces.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-black/10 bg-white/40 px-4 py-8 text-center text-sm text-[var(--muted)]">
                No workspace matches that search yet.
              </div>
            ) : null}
          </div>

          <div className="mt-5 rounded-[24px] border border-black/8 bg-[rgba(31,27,22,0.94)] p-4 text-white">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/60">
              Collaboration
            </p>
            <p className="mt-3 text-sm leading-7 text-white/76">
              Shared boards, presence cursors, and real sync should sit on Supabase
              auth, storage, and realtime channels next.
            </p>
          </div>
        </aside>

        <section className="flex min-h-[720px] flex-col rounded-[30px] border border-black/8 bg-[rgba(255,251,245,0.72)] shadow-[0_18px_60px_rgba(55,37,20,0.06)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/8 px-4 py-4">
            <div>
              <div className="flex items-center gap-2">
                <ViewerBadge tone="default">
                  {activeWorkspace.shared ? "Shared board" : "Private board"}
                </ViewerBadge>
                <ViewerBadge tone="muted">{activeWorkspace.name}</ViewerBadge>
              </div>
              <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                {activeWorkspace.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ToolbarButton onClick={() => fileInputRef.current?.click()}>
                Upload images
              </ToolbarButton>
              <ToolbarButton onClick={() => addTextAtCenter()}>Add text</ToolbarButton>
              <ToolbarButton
                onClick={duplicateSelectedItem}
                disabled={!selectedItem}
              >
                Duplicate
              </ToolbarButton>
              <ToolbarButton
                onClick={() =>
                  patchActiveWorkspace(
                    (workspace) => ({
                      ...workspace,
                      shared: !workspace.shared,
                    }),
                  )
                }
              >
                {activeWorkspace.shared ? "Make private" : "Share board"}
              </ToolbarButton>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {activeWorkspace.collaborators.map((person, index) => (
                  <div
                    key={`${person}-${index}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white bg-[rgba(31,27,22,0.92)] text-xs font-semibold text-white"
                  >
                    {person}
                  </div>
                ))}
              </div>
              <p className="text-sm text-[var(--muted)]">
                Shared with {activeWorkspace.collaborators.length} collaborators
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateZoom(activeWorkspace.view.zoom - 0.1)}
                className="h-10 w-10 rounded-full border border-black/8 bg-white/80 text-lg"
              >
                -
              </button>
              <div className="min-w-20 rounded-full border border-black/8 bg-white/80 px-4 py-2 text-center text-sm font-semibold">
                {Math.round(activeWorkspace.view.zoom * 100)}%
              </div>
              <button
                type="button"
                onClick={() => updateZoom(activeWorkspace.view.zoom + 0.1)}
                className="h-10 w-10 rounded-full border border-black/8 bg-white/80 text-lg"
              >
                +
              </button>
              <ToolbarButton
                onClick={() =>
                  patchActiveWorkspace(
                    (workspace) => ({ ...workspace, view: defaultView }),
                    { touchTimestamp: false },
                  )
                }
              >
                Reset view
              </ToolbarButton>
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
            className="relative mx-3 mb-3 flex-1 overflow-hidden rounded-[28px] border border-black/8 bg-[#efe7da]"
          >
            <div className="pointer-events-none absolute inset-x-5 top-5 z-20 flex flex-wrap gap-2">
              <ViewerBadge tone="muted">Drag empty space to pan</ViewerBadge>
              <ViewerBadge tone="muted">Pinch or Ctrl-scroll to zoom</ViewerBadge>
              <ViewerBadge tone="muted">Double-click to add text</ViewerBadge>
            </div>

            <div
              className="pointer-events-none absolute inset-0 opacity-80"
              style={{
                background:
                  "radial-gradient(circle at top left, rgba(255,255,255,0.55), transparent 28%), radial-gradient(circle at bottom right, rgba(212,108,78,0.12), transparent 24%)",
              }}
            />

            <div
              className="absolute left-0 top-0"
              style={{
                width: BOARD_SIZE.width,
                height: BOARD_SIZE.height,
                transform: `translate(${activeWorkspace.view.panX}px, ${activeWorkspace.view.panY}px) scale(${activeWorkspace.view.zoom})`,
                transformOrigin: "0 0",
              }}
            >
              <div className="canvas-grid canvas-dots absolute inset-0 rounded-[40px]" />

              {activeWorkspace.items
                .toSorted((left, right) => left.zIndex - right.zIndex)
                .map((item) => {
                  const isSelected = item.id === selectedItem?.id;
                  return (
                    <div
                      key={item.id}
                      data-item-id={item.id}
                      onPointerDown={(event) => handleItemPointerDown(event, item)}
                      className="group absolute transition-shadow"
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
                            isSelected
                              ? "border-[3px] border-[var(--accent)]"
                              : "border-white/70"
                          }`}
                          style={{
                            borderRadius: item.borderRadius,
                            boxShadow: `0 ${Math.round(item.shadow / 2)}px ${item.shadow}px rgba(44, 30, 20, 0.18)`,
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
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/35 to-transparent px-4 py-3 text-sm font-semibold text-white opacity-0 transition group-hover:opacity-100">
                            {item.label}
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`h-full rounded-[24px] border ${
                            isSelected
                              ? "border-[3px] border-[var(--accent)] bg-white/82"
                              : "border-transparent bg-white/55"
                          } px-5 py-4 shadow-[0_20px_45px_rgba(41,31,20,0.08)] backdrop-blur`}
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
                          className="absolute bottom-[-9px] right-[-9px] h-5 w-5 rounded-full border-2 border-white bg-[var(--accent)] shadow-[0_10px_20px_rgba(0,0,0,0.16)]"
                        />
                      ) : null}
                    </div>
                  );
                })}
            </div>

            {isDraggingFiles ? (
              <div className="absolute inset-6 z-30 flex items-center justify-center rounded-[28px] border-2 border-dashed border-[var(--accent)] bg-[rgba(255,250,245,0.92)]">
                <div className="text-center">
                  <p className="text-xl font-semibold tracking-[-0.03em]">
                    Drop images into the board
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Each file becomes its own resizable, croppable frame.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="space-y-4 rounded-[30px] border border-black/8 bg-[rgba(255,251,245,0.78)] p-4 shadow-[0_18px_60px_rgba(55,37,20,0.06)] backdrop-blur">
          <PanelSection eyebrow="Inspector" title={selectedItem ? formatItemType(selectedItem.type) : "Board details"}>
            {selectedItem ? (
              <div className="space-y-4">
                <div className="rounded-[20px] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent)]">
                  Selected layer: {selectedItem.type === "image" ? selectedItem.label : "Text block"}
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
                        className="min-h-28 w-full rounded-[20px] border border-black/8 bg-white/75 px-4 py-3 text-sm leading-7 outline-none"
                      />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Font size">
                        <input
                          type="range"
                          min={22}
                          max={110}
                          value={selectedItem.fontSize}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "text"
                                ? { ...item, fontSize: Number(event.target.value) }
                                : item,
                            )
                          }
                          className="w-full"
                        />
                      </Field>
                      <Field label="Weight">
                        <input
                          type="range"
                          min={500}
                          max={800}
                          step={100}
                          value={selectedItem.weight}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "text"
                                ? {
                                    ...item,
                                    weight: Number(event.target.value) as TextItem["weight"],
                                  }
                                : item,
                            )
                          }
                          className="w-full"
                        />
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Text color">
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
                          className="h-12 w-full rounded-[16px] border border-black/8 bg-white/75 p-2"
                        />
                      </Field>

                      <Field label="Alignment">
                        <div className="grid grid-cols-2 gap-2">
                          {(["left", "center"] as const).map((align) => (
                            <button
                              key={align}
                              type="button"
                              onClick={() =>
                                patchSelectedItem((item) =>
                                  item.type === "text" ? { ...item, align } : item,
                                )
                              }
                              className={`rounded-2xl border px-3 py-3 text-sm font-semibold ${
                                selectedItem.align === align
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                                  : "border-black/8 bg-white/75"
                              }`}
                            >
                              {align}
                            </button>
                          ))}
                        </div>
                      </Field>
                    </div>
                  </>
                ) : (
                  <>
                    <Field label="Image label">
                      <input
                        value={selectedItem.label}
                        onChange={(event) =>
                          patchSelectedItem((item) =>
                            item.type === "image"
                              ? { ...item, label: event.target.value }
                              : item,
                          )
                        }
                        className="w-full rounded-[20px] border border-black/8 bg-white/75 px-4 py-3 text-sm outline-none"
                      />
                    </Field>

                    <div className="space-y-3">
                      <Field label={`Crop X ${roundNumber(selectedItem.cropX)}px`}>
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

                      <Field label={`Crop Y ${roundNumber(selectedItem.cropY)}px`}>
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
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Corner radius">
                        <input
                          type="range"
                          min={0}
                          max={48}
                          value={selectedItem.borderRadius}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "image"
                                ? { ...item, borderRadius: Number(event.target.value) }
                                : item,
                            )
                          }
                          className="w-full"
                        />
                      </Field>
                      <Field label="Shadow depth">
                        <input
                          type="range"
                          min={8}
                          max={44}
                          value={selectedItem.shadow}
                          onChange={(event) =>
                            patchSelectedItem((item) =>
                              item.type === "image"
                                ? { ...item, shadow: Number(event.target.value) }
                                : item,
                            )
                          }
                          className="w-full"
                        />
                      </Field>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Width">
                    <input
                      type="number"
                      min={120}
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
                      className="w-full rounded-[20px] border border-black/8 bg-white/75 px-4 py-3 text-sm outline-none"
                    />
                  </Field>
                  <Field label="Height">
                    <input
                      type="number"
                      min={80}
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
                      className="w-full rounded-[20px] border border-black/8 bg-white/75 px-4 py-3 text-sm outline-none"
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <ToolbarButton onClick={duplicateSelectedItem}>Duplicate</ToolbarButton>
                  <ToolbarButton onClick={removeSelectedItem}>Delete</ToolbarButton>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[20px] bg-white/75 p-4">
                  <p className="text-sm font-semibold">Board health</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <MetricCard label="Images" value={workspaceImages.length} />
                    <MetricCard label="Text blocks" value={workspaceTexts.length} />
                    <MetricCard label="Layers" value={activeWorkspace.items.length} />
                    <MetricCard
                      label="Shared"
                      value={activeWorkspace.shared ? "Yes" : "No"}
                    />
                  </div>
                </div>

                <div className="rounded-[20px] border border-black/8 bg-white/70 p-4 text-sm leading-7 text-[var(--muted)]">
                  Use the left rail for board switching, drop files straight into the
                  canvas, and shape image crops from this inspector once a frame is
                  selected.
                </div>
              </div>
            )}
          </PanelSection>

          <PanelSection eyebrow="Sync plan" title="Backend-ready next steps">
            <div className="space-y-3 text-sm leading-7 text-[var(--muted)]">
              <p>Google sign-in should be wired with Supabase Auth.</p>
              <p>Boards, layers, and comments should live in Postgres with row-level security.</p>
              <p>Uploads belong in Supabase Storage, then realtime presence can mirror Figma-like collaboration.</p>
            </div>
          </PanelSection>

          <PanelSection eyebrow="Shortcuts" title="Fast editing">
            <div className="space-y-2 text-sm text-[var(--muted)]">
              <ShortcutRow shortcut="T" description="Add a text note at the center" />
              <ShortcutRow shortcut="F" description="Open image picker" />
              <ShortcutRow shortcut="Del" description="Delete the selected layer" />
              <ShortcutRow shortcut="Double click" description="Create text on the canvas" />
            </div>
          </PanelSection>
        </aside>
      </div>
    </main>
  );
}

function FeatureStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-black/8 bg-white/65 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold tracking-[-0.03em]">{value}</p>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-black/8 bg-white/80 px-4 py-2.5 text-sm font-semibold transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-[18px] border border-black/8 bg-[rgba(255,251,245,0.82)] p-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-[-0.03em]">{value}</p>
    </div>
  );
}

function ShortcutRow({
  shortcut,
  description,
}: {
  shortcut: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] border border-black/8 bg-white/65 px-3 py-2.5">
      <span className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--foreground)]">
        {shortcut}
      </span>
      <span className="text-right">{description}</span>
    </div>
  );
}
