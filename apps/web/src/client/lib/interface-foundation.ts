export const PAGE_SHELL_WIDTHS = {
  reading: 'max-w-6xl',
  workspace: 'max-w-[1600px]',
  wide: 'max-w-[1600px]',
} as const;

export const ANIMATED_ICON_FRAME_CLASS = 'shrink-0 [&_svg]:h-full [&_svg]:w-full';

export const ANIMATED_ICON_FALLBACKS = {
  AlertCircle: 'Info',
  AlertTriangle: 'TriangleAlert',
  Archive: 'PackageOpen',
  ArrowLeft: 'MoveLeft',
  ArrowRight: 'MoveRight',
  ArrowUp: 'AArrowUp',
  Bot: 'Brain',
  BrainCircuit: 'Brain',
  CheckCircle2: 'CircleCheck',
  CircleStop: 'Disc3',
  Eraser: 'Trash2',
  Focus: 'Scan',
  FolderPlus: 'CirclePlus',
  Globe2: 'Globe',
  Inbox: 'Mails',
  Languages: 'Globe',
  Layers3: 'Layers',
  Library: 'BookOpenText',
  LineChart: 'ChartLine',
  Link2: 'Link',
  ListOrdered: 'ListChevronsUpDown',
  ListVideo: 'Video',
  Loader2: 'Loader',
  Maximize2: 'MoveDiagonal2',
  MessageSquare: 'MessageCircle',
  MoreHorizontal: 'Ellipsis',
  Music2: 'Music',
  Network: 'ChartNetwork',
  Notebook: 'BookOpenText',
  NotebookPen: 'BookOpenText',
  PanelLeft: 'LayoutList',
  PanelLeftClose: 'ChevronsLeft',
  PanelLeftOpen: 'Menu',
  PlayCircle: 'Play',
  Plug: 'Webhook',
  Puzzle: 'Blocks',
  RotateCcw: 'Repeat',
  RotateCw: 'RefreshCw',
  ShieldAlert: 'TriangleAlert',
  Square: 'Box',
  SquarePlus: 'CirclePlus',
  Tags: 'Bookmark',
  Type: 'FileText',
  Wand2: 'Sparkles',
  Workflow: 'GitBranch',
  Wrench: 'Settings',
  XCircle: 'ShieldX',
  ZoomIn: 'CirclePlus',
  ZoomOut: 'Minus',
} as const;

export function shouldAnimateDecoration(reduceMotion: boolean | null, requested = true): boolean {
  return requested && !reduceMotion;
}

interface AnimationStyleTarget {
  style: Pick<CSSStyleDeclaration, 'removeProperty'>;
}

export function resetAnimationStyles(targets: Iterable<AnimationStyleTarget>): void {
  for (const target of targets) {
    target.style.removeProperty('opacity');
    target.style.removeProperty('visibility');
    target.style.removeProperty('transform');
  }
}

export function safelyRunAnimation(run: () => void, onFailure?: () => void): boolean {
  try {
    run();
    return true;
  } catch {
    onFailure?.();
    return false;
  }
}
