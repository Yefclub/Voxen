export const PAGE_SHELL_WIDTHS = {
  reading: 'max-w-4xl',
  workspace: 'max-w-7xl',
  wide: 'max-w-[1600px]',
} as const;

export const ANIMATED_ICON_FRAME_CLASS = 'shrink-0 [&_svg]:h-full [&_svg]:w-full';

export const ANIMATED_ICON_FALLBACKS = {
  ArrowLeft: 'MoveLeft',
  ArrowRight: 'MoveRight',
  BrainCircuit: 'Brain',
  FolderPlus: 'CirclePlus',
  Library: 'BookOpenText',
  ListOrdered: 'ListChevronsUpDown',
  MessageSquare: 'MessageCircle',
  Network: 'ChartNetwork',
  Notebook: 'BookOpenText',
  PanelLeftOpen: 'Menu',
  Puzzle: 'Blocks',
  Tags: 'Bookmark',
  Wrench: 'Settings',
  ZoomIn: 'CirclePlus',
  ZoomOut: 'Minus',
} as const;

export function shouldAnimateDecoration(reduceMotion: boolean | null, requested = true): boolean {
  return requested && !reduceMotion;
}

export function safelyRunAnimation(run: () => void): boolean {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}
