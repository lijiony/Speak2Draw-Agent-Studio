export type ShapeKind = 'circle' | 'rectangle' | 'ellipse' | 'line' | 'triangle' | 'text';
export type LayerDirection = 'front' | 'back' | 'forward' | 'backward';

export type DrawingIntentType =
  | 'sequence'
  | 'help'
  | 'describe_scene'
  | 'describe_selection'
  | 'create_shape'
  | 'create_complex_scene'
  | 'create_asset_recipe'
  | 'select_object'
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
}

export interface PositionHint {
  x: number;
  y: number;
}

export interface SceneStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface SceneObject {
  id: string;
  kind: ShapeKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: SceneStyle;
  text?: string;
  createdAt: number;
}

export interface DrawingRecipeItem {
  shape: ShapeKind;
  name?: string;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  position?: PositionHint;
  width?: number;
  height?: number;
  text?: string;
}

export interface SceneSnapshot {
  objects: SceneObject[];
  selectedId: string | null;
}

export interface SceneState extends SceneSnapshot {
  past: SceneSnapshot[];
  future: SceneSnapshot[];
}

export interface DrawingIntent {
  type: DrawingIntentType;
  rawText: string;
  intents?: DrawingIntent[];
  shape?: ShapeKind;
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
  scale?: number;
  recipe?: DrawingRecipeItem[];
  reason?: string;
}

export interface ObjectSelector {
  mode: 'last' | 'selected' | 'by_shape_color' | 'by_name';
  shape?: ShapeKind;
  color?: string;
  name?: string;
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
  scale?: number;
}

export interface ExecutionResult {
  ok: boolean;
  message: string;
  scene: SceneState;
  commandsExecuted: number;
  latencyMs: number;
  needsClarification?: boolean;
  exportSvg?: string;
}
