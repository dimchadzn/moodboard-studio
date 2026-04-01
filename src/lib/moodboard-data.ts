export const BOARD_SIZE = {
  width: 5200,
  height: 3600,
} as const;

export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 1.9;

export type CanvasView = {
  panX: number;
  panY: number;
  zoom: number;
};

type BaseItem = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation: number;
};

export type ImageItem = BaseItem & {
  type: "image";
  src: string;
  label: string;
  originalWidth: number;
  originalHeight: number;
  cropX: number;
  cropY: number;
  cropScale: number;
  borderRadius: number;
  shadow: number;
  aspectRatioLocked: boolean;
};

export type TextItem = BaseItem & {
  type: "text";
  text: string;
  color: string;
  fontSize: number;
  weight: 500 | 600 | 700 | 800;
  letterSpacing: number;
  align: "left" | "center";
};

export type BoardItem = ImageItem | TextItem;

export type Workspace = {
  id: string;
  ownerId: string | null;
  name: string;
  description: string;
  accent: string;
  shared: boolean;
  collaborators: string[];
  updatedAt: string;
  view: CanvasView;
  items: BoardItem[];
};

export type AppState = {
  userName: string;
  activeWorkspaceId: string;
  selectedItemId: string | null;
  workspaces: Workspace[];
};

export const defaultView: CanvasView = {
  panX: -1420,
  panY: -860,
  zoom: 0.74,
};

export const initialAppState: AppState = {
  userName: "Dimitris",
  activeWorkspaceId: "brand-sprint",
  selectedItemId: "brand-title",
  workspaces: [
    {
      id: "brand-sprint",
      ownerId: null,
      name: "Brand Sprint",
      description: "Editorial direction and image rhythm.",
      accent: "#d0cbc1",
      shared: true,
      collaborators: ["DI", "AN", "LU"],
      updatedAt: "2026-04-01T10:30:00.000Z",
      view: defaultView,
      items: [
        {
          id: "brand-title",
          type: "text",
          text: "Muse\nSpring reset",
          x: 1080,
          y: 250,
          width: 500,
          height: 220,
          zIndex: 1,
          rotation: 0,
          color: "#f2efe8",
          fontSize: 76,
          weight: 800,
          letterSpacing: -2.8,
          align: "left",
        },
        {
          id: "brand-image-1",
          type: "image",
          src: "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1200&q=80",
          label: "Quiet interior palette",
          x: 1630,
          y: 340,
          width: 420,
          height: 540,
          zIndex: 4,
          rotation: 0,
          originalWidth: 420,
          originalHeight: 540,
          cropX: 0,
          cropY: 0,
          cropScale: 1,
          borderRadius: 6,
          shadow: 18,
          aspectRatioLocked: true,
        },
        {
          id: "brand-image-2",
          type: "image",
          src: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80",
          label: "Editorial portrait reference",
          x: 2140,
          y: 570,
          width: 300,
          height: 360,
          zIndex: 5,
          rotation: 0,
          originalWidth: 300,
          originalHeight: 360,
          cropX: 0,
          cropY: 0,
          cropScale: 1.1,
          borderRadius: 4,
          shadow: 14,
          aspectRatioLocked: true,
        },
        {
          id: "brand-image-3",
          type: "image",
          src: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80",
          label: "Texture and color balance",
          x: 980,
          y: 930,
          width: 360,
          height: 420,
          zIndex: 2,
          rotation: 0,
          originalWidth: 360,
          originalHeight: 420,
          cropX: 0,
          cropY: -18,
          cropScale: 1.08,
          borderRadius: 5,
          shadow: 16,
          aspectRatioLocked: true,
        },
        {
          id: "brand-note",
          type: "text",
          text: "Keep the mood refined.\nSoft clay, oat paper, sunlight,\nnot glossy luxury.",
          x: 1420,
          y: 970,
          width: 420,
          height: 150,
          zIndex: 3,
          rotation: 0,
          color: "#9d978d",
          fontSize: 28,
          weight: 600,
          letterSpacing: -0.6,
          align: "left",
        },
      ],
    },
    {
      id: "interior-direction",
      ownerId: null,
      name: "Interior Direction",
      description: "Spatial references and interior mood.",
      accent: "#a59e93",
      shared: false,
      collaborators: ["DI", "MK"],
      updatedAt: "2026-04-01T09:10:00.000Z",
      view: {
        panX: -1350,
        panY: -780,
        zoom: 0.78,
      },
      items: [
        {
          id: "interior-title",
          type: "text",
          text: "Gallery home\nstudy",
          x: 860,
          y: 320,
          width: 460,
          height: 180,
          zIndex: 1,
          rotation: 0,
          color: "#f2efe8",
          fontSize: 74,
          weight: 800,
          letterSpacing: -2.5,
          align: "left",
        },
        {
          id: "interior-image-1",
          type: "image",
          src: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
          label: "Minimal lounge shape",
          x: 1450,
          y: 280,
          width: 470,
          height: 610,
          zIndex: 4,
          rotation: 0,
          originalWidth: 470,
          originalHeight: 610,
          cropX: 0,
          cropY: 0,
          cropScale: 1,
          borderRadius: 6,
          shadow: 18,
          aspectRatioLocked: true,
        },
        {
          id: "interior-image-2",
          type: "image",
          src: "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80",
          label: "Dining composition",
          x: 2020,
          y: 520,
          width: 380,
          height: 320,
          zIndex: 5,
          rotation: 0,
          originalWidth: 380,
          originalHeight: 320,
          cropX: 0,
          cropY: 0,
          cropScale: 1.08,
          borderRadius: 4,
          shadow: 14,
          aspectRatioLocked: true,
        },
        {
          id: "interior-note",
          type: "text",
          text: "Architectural calm.\nMuted stone, deep olive,\nartwork with breathing room.",
          x: 1000,
          y: 1040,
          width: 500,
          height: 140,
          zIndex: 3,
          rotation: 0,
          color: "#999287",
          fontSize: 27,
          weight: 600,
          letterSpacing: -0.4,
          align: "left",
        },
      ],
    },
    {
      id: "campaign-shoot",
      ownerId: null,
      name: "Campaign Shoot",
      description: "Motion references and crop direction.",
      accent: "#beb8ad",
      shared: true,
      collaborators: ["DI", "JA", "SO", "ME"],
      updatedAt: "2026-03-31T21:40:00.000Z",
      view: {
        panX: -1490,
        panY: -900,
        zoom: 0.72,
      },
      items: [
        {
          id: "campaign-title",
          type: "text",
          text: "Motion\nreferences",
          x: 940,
          y: 260,
          width: 500,
          height: 200,
          zIndex: 1,
          rotation: 0,
          color: "#f2efe8",
          fontSize: 80,
          weight: 800,
          letterSpacing: -2.6,
          align: "left",
        },
        {
          id: "campaign-image-1",
          type: "image",
          src: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1200&q=80",
          label: "Running silhouette",
          x: 1600,
          y: 320,
          width: 430,
          height: 570,
          zIndex: 4,
          rotation: 0,
          originalWidth: 430,
          originalHeight: 570,
          cropX: 0,
          cropY: 0,
          cropScale: 1.03,
          borderRadius: 6,
          shadow: 18,
          aspectRatioLocked: true,
        },
        {
          id: "campaign-image-2",
          type: "image",
          src: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80",
          label: "Close crop portrait",
          x: 2120,
          y: 520,
          width: 310,
          height: 390,
          zIndex: 5,
          rotation: 0,
          originalWidth: 310,
          originalHeight: 390,
          cropX: 16,
          cropY: 0,
          cropScale: 1.18,
          borderRadius: 4,
          shadow: 14,
          aspectRatioLocked: true,
        },
        {
          id: "campaign-note",
          type: "text",
          text: "Lean into speed.\nCropping should feel accidental but precise.",
          x: 1080,
          y: 1000,
          width: 500,
          height: 140,
          zIndex: 2,
          rotation: 0,
          color: "#9a9387",
          fontSize: 26,
          weight: 600,
          letterSpacing: -0.4,
          align: "left",
        },
      ],
    },
  ],
};
