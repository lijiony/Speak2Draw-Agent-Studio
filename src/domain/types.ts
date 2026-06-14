export type ShapeKind = 'circle' | 'rectangle' | 'ellipse' | 'line' | 'triangle' | 'text' | 'svg_artwork';
export type PrimitiveShapeKind = Exclude<ShapeKind, 'svg_artwork'>;
export type LayerDirection = 'front' | 'back' | 'forward' | 'backward';
export type AlignmentMode = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export type DistributionAxis = 'horizontal' | 'vertical';
export type SelectionScope = 'group' | 'part';
export type RecipeSlot = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type RecipeSize = 'tiny' | 'small' | 'medium' | 'large';

export type DrawingIntentType =
  | 'sequence'
  | 'help'
  | 'describe_scene'
  | 'describe_selection'
  | 'create_shape'
  | 'create_complex_scene'
  | 'create_asset_recipe'
  | 'revise_asset_part'
  | 'select_object'
  | 'rename_object'
  | 'duplicate_object'
  | 'update_text'
  | 'group_objects'
  | 'ungroup_objects'
  | 'align_objects'
  | 'distribute_objects'
  | 'update_style'
  | 'move_object'
  | 'resize_object'
  | 'reorder_object'
  | 'delete_object'
  | 'undo'
  | 'redo'
  | 'clear_canvas'
  | 'export_canvas'
  | 'clarify'
  | 'unknown';

export type DrawingCommandType =
  | 'create_object'
  | 'select_object'
  | 'update_object'
  | 'move_object'
  | 'resize_object'
  | 'reorder_object'
  | 'group_objects'
  | 'ungroup_objects'
  | 'align_objects'
  | 'distribute_objects'
  | 'delete_object'
  | 'undo'
  | 'redo'
  | 'clear_canvas'
  | 'export_canvas';

export interface VoiceTranscript {
  text: string;
  confidence: number;
  receivedAt: number;
  isFinal: boolean;
  source?: 'final' | 'interim-fallback' | 'manual-test';
  utteranceId?: string;
  startedAt?: number;
  committedAt?: number;
  stabilityMs?: number;
}

export interface PositionHint {
  x: number;
  y: number;
}

export interface RecipeOffset {
  x: number;
  y: number;
}

export interface SceneStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface SvgArtworkPart {
  id: string;
  partName: string;
  role?: string;
  editable: boolean;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface SvgArtworkData {
  name: string;
  viewBox: string;
  safeMarkup: string;
  parts: SvgArtworkPart[];
  qualityNotes?: string;
  diagnostics: SvgArtworkDiagnostics;
}

export interface SceneObject {
  id: string;
  kind: ShapeKind;
  name: string;
  groupId?: string;
  groupName?: string;
  partId?: string;
  partName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: SceneStyle;
  text?: string;
  svgArtwork?: SvgArtworkData;
  createdAt: number;
}

export interface DrawingRecipeItem {
  shape: PrimitiveShapeKind;
  name?: string;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  position?: PositionHint;
  width?: number;
  height?: number;
  text?: string;
  partName?: string;
  slot?: RecipeSlot;
  relativeTo?: string;
  offset?: RecipeOffset;
  size?: RecipeSize;
}

export interface LayoutPartDiagnostics {
  index: number;
  name: string;
  partName?: string;
  shape: PrimitiveShapeKind;
  slot: RecipeSlot;
  relativeTo?: string;
  size: RecipeSize;
  x: number;
  y: number;
  width: number;
  height: number;
  warnings?: string[];
}

export interface LayoutDiagnostics {
  schemaVersion?: string;
  rawSummary?: string;
  transcript?: string;
  groupName?: string;
  groupId?: string;
  inputCount: number;
  acceptedCount: number;
  droppedCount: number;
  commandCount: number;
  warnings: string[];
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  parts: LayoutPartDiagnostics[];
}

export interface SvgArtworkDiagnostics {
  generationMode: 'safe-svg-artwork';
  schemaVersion?: string;
  rawSummary?: string;
  transcript?: string;
  name?: string;
  viewBox?: string;
  sanitizerStatus: 'accepted' | 'rejected' | 'fallback';
  sanitizedElementCount: number;
  droppedElementCount: number;
  droppedAttributeCount: number;
  partCount: number;
  safeMarkupLength: number;
  fallbackReason?: string;
  qualityNotes?: string;
  warnings: string[];
}

export type SceneSelection =
  | {
      scope: 'group';
      groupId: string;
      anchorObjectId?: string;
    }
  | {
      scope: 'part';
      objectId: string;
      groupId?: string;
      partId?: string;
      partName?: string;
    };

export interface SceneSnapshot {
  objects: SceneObject[];
  selectedId: string | null;
  selection: SceneSelection | null;
  revision: number;
}

export interface SceneState extends SceneSnapshot {
  past: SceneSnapshot[];
  future: SceneSnapshot[];
}

export interface DrawingIntent {
  type: DrawingIntentType;
  rawText: string;
  intents?: DrawingIntent[];
  shape?: PrimitiveShapeKind;
  color?: string;
  name?: string;
  strokeColor?: string;
  strokeWidth?: number;
  position?: PositionHint;
  width?: number;
  height?: number;
  text?: string;
  selector?: ObjectSelector;
  direction?: 'left' | 'right' | 'up' | 'down' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  layer?: LayerDirection;
  alignment?: AlignmentMode;
  axis?: DistributionAxis;
  scale?: number;
  recipe?: DrawingRecipeItem[];
  attachTo?: ObjectSelector;
  operation?: 'delete' | 'replace';
  reason?: string;
}

export interface ObjectSelector {
  mode: 'last' | 'selected' | 'all' | 'by_shape_color' | 'by_name' | 'by_names' | 'by_id' | 'by_group_id' | 'by_part_name';
  scope?: SelectionScope;
  objectId?: string;
  groupId?: string;
  shape?: PrimitiveShapeKind;
  color?: string;
  name?: string;
  names?: string[];
  withinGroupName?: string;
}

export interface DrawingCommand {
  type: DrawingCommandType;
  object?: SceneObject;
  selector?: ObjectSelector;
  updates?: Partial<Omit<SceneObject, 'id' | 'kind' | 'createdAt' | 'style'>> & {
    style?: Partial<SceneStyle>;
  };
  direction?: DrawingIntent['direction'];
  layer?: LayerDirection;
  alignment?: AlignmentMode;
  axis?: DistributionAxis;
  scale?: number;
  groupId?: string;
  groupName?: string;
}

export interface ExecutionResult {
  ok: boolean;
  message: string;
  scene: SceneState;
  commandsExecuted: number;
  latencyMs: number;
  needsClarification?: boolean;
  exportSvg?: string;
  layoutDiagnostics?: LayoutDiagnostics;
  svgArtworkDiagnostics?: SvgArtworkDiagnostics;
}
