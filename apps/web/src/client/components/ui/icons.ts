import {
  createElement,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type ComponentType,
  type HTMLAttributes,
  type MouseEvent,
  type RefAttributes,
} from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '../../lib/utils';
import { ANIMATED_ICON_FRAME_CLASS, shouldAnimateDecoration } from '../../lib/interface-foundation';
import type { IconCueHandle } from '../../lib/icon-cue';
export { ANIMATED_ICON_FALLBACKS } from '../../lib/interface-foundation';
import {
  AArrowUpIcon,
  BlocksIcon,
  BookOpenTextIcon,
  BookmarkIcon,
  BoxIcon,
  BrainIcon,
  CalendarIcon,
  ChartLineIcon,
  ChartNetworkIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsLeftIcon,
  CircleCheckIcon,
  CirclePlusIcon,
  ClockIcon,
  CopyIcon,
  Disc3Icon,
  DollarSignIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GlobeIcon,
  HouseIcon,
  ImageIcon,
  InfoIcon,
  KeyRoundIcon,
  LayersIcon,
  LayoutListIcon,
  LinkIcon,
  ListChevronsUpDownIcon,
  LoaderCircleIcon,
  LoaderIcon,
  LockIcon,
  LogoutIcon,
  MailsIcon,
  MenuIcon,
  MessageCircleIcon,
  MinusIcon,
  MoonIcon,
  MoveDiagonal2Icon,
  MoveLeftIcon,
  MoveRightIcon,
  MusicIcon,
  PackageOpenIcon,
  PaperclipIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  QrCodeIcon,
  RefreshCwIcon,
  RepeatIcon,
  SaveIcon,
  ScanIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  ShareIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  SparklesIcon,
  SunIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  Volume2Icon,
  VolumeXIcon,
  WebhookIcon,
  WifiOffIcon,
  XIcon,
  ZapIcon,
} from '@animateicons/react/lucide';

export interface AnimatedIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  duration?: number;
  isAnimated?: boolean;
  color?: string;
}

/**
 * Ícone da aplicação. Aceita `ref` para expor o handle de animação, usado pelas
 * deixas coordenadas de `lib/icon-cue`.
 */
export type AnimatedIcon = ComponentType<AnimatedIconProps & RefAttributes<IconCueHandle>>;
/** Compatibilidade temporária para tipos de configuração já nomeados no app. */
export type LucideIcon = AnimatedIcon;

/**
 * Envolve um ícone do pacote para expor o handle de animação por `ref` sem
 * perder nada do comportamento padrão.
 *
 * Exportado para teste: `icons.test.ts` renderiza este wrapper com um ícone
 * sonda para conferir o que chega no ícone interno.
 */
export function accessibleIcon(icon: AnimatedIcon): AnimatedIcon {
  const AccessibleAnimatedIcon = forwardRef<IconCueHandle, AnimatedIconProps>(
    function AccessibleAnimatedIcon(
      { isAnimated, className, onMouseEnter, onMouseLeave, ...props },
      ref,
    ) {
      const reduceMotion = useReducedMotion();
      const inner = useRef<IconCueHandle>(null);
      const animated = shouldAnimateDecoration(reduceMotion, isAnimated);

      useImperativeHandle(
        ref,
        () => ({
          startAnimation: () => {
            if (animated) inner.current?.startAnimation();
          },
          stopAnimation: () => inner.current?.stopAnimation(),
        }),
        [animated],
      );

      // ⚠️ NÃO REMOVA estes dois handlers. O `@animateicons/react` anima o
      // hover sozinho SOMENTE enquanto ninguém anexa uma `ref` ao ícone: com
      // ref anexada ele para de escutar o mouse e passa a delegar para os
      // handlers recebidos. Como o wrapper anexa `inner` em TODOS os ícones,
      // apagar (ou deixar de repassar) `onMouseEnter`/`onMouseLeave` mata a
      // animação de hover dos 102 ícones do app de uma vez — em silêncio, sem
      // erro de tipo e sem quebrar nenhuma tela.
      // `icons.test.ts` trava os dois lados: que os handlers existem e que
      // eles chamam `startAnimation`/`stopAnimation` no ícone interno —
      // esvaziar o corpo dos handlers quebra a suíte.
      const handleMouseEnter = useCallback(
        (event: MouseEvent<HTMLDivElement>) => {
          onMouseEnter?.(event);
          if (animated) inner.current?.startAnimation();
        },
        [animated, onMouseEnter],
      );
      const handleMouseLeave = useCallback(
        (event: MouseEvent<HTMLDivElement>) => {
          onMouseLeave?.(event);
          inner.current?.stopAnimation();
        },
        [onMouseLeave],
      );

      return createElement(icon, {
        ...props,
        ref: inner,
        className: cn(ANIMATED_ICON_FRAME_CLASS, className),
        isAnimated: animated,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
      });
    },
  );

  const source = icon as { displayName?: string; name?: string };
  AccessibleAnimatedIcon.displayName = `AccessibleAnimatedIcon(${source.displayName ?? source.name})`;
  return AccessibleAnimatedIcon;
}

// Quando o catálogo ainda não oferece um desenho exato, usamos o equivalente
// animado semanticamente mais próximo, documentado por ANIMATED_ICON_FALLBACKS.
export const Box = accessibleIcon(BoxIcon);
export const Calendar = accessibleIcon(CalendarIcon);
export const Check = accessibleIcon(CheckIcon);
export const ChevronDown = accessibleIcon(ChevronDownIcon);
export const ChevronLeft = accessibleIcon(ChevronLeftIcon);
export const ChevronRight = accessibleIcon(ChevronRightIcon);
export const ChevronUp = accessibleIcon(ChevronUpIcon);
export const Clock = accessibleIcon(ClockIcon);
export const Copy = accessibleIcon(CopyIcon);
export const DollarSign = accessibleIcon(DollarSignIcon);
export const Download = accessibleIcon(DownloadIcon);
export const ExternalLink = accessibleIcon(ExternalLinkIcon);
export const Eye = accessibleIcon(EyeIcon);
export const EyeOff = accessibleIcon(EyeOffIcon);
export const FileText = accessibleIcon(FileTextIcon);
export const Folder = accessibleIcon(FolderIcon);
export const FolderOpen = accessibleIcon(FolderOpenIcon);
export const Globe = accessibleIcon(GlobeIcon);
export const House = accessibleIcon(HouseIcon);
export const Image = accessibleIcon(ImageIcon);
export const KeyRound = accessibleIcon(KeyRoundIcon);
export const LoaderCircle = accessibleIcon(LoaderCircleIcon);
export const Lock = accessibleIcon(LockIcon);
export const LogOut = accessibleIcon(LogoutIcon);
export const MessageCircle = accessibleIcon(MessageCircleIcon);
export const Moon = accessibleIcon(MoonIcon);
export const Paperclip = accessibleIcon(PaperclipIcon);
export const Pause = accessibleIcon(PauseIcon);
export const Pencil = accessibleIcon(PencilIcon);
export const Play = accessibleIcon(PlayIcon);
export const Plus = accessibleIcon(PlusIcon);
export const QrCode = accessibleIcon(QrCodeIcon);
export const RefreshCw = accessibleIcon(RefreshCwIcon);
export const Save = accessibleIcon(SaveIcon);
export const Search = accessibleIcon(SearchIcon);
export const Send = accessibleIcon(SendIcon);
export const Settings = accessibleIcon(SettingsIcon);
export const Share = accessibleIcon(ShareIcon);
export const ShieldCheck = accessibleIcon(ShieldCheckIcon);
export const ShieldX = accessibleIcon(ShieldXIcon);
export const SlidersHorizontal = accessibleIcon(SlidersHorizontalIcon);
export const Smartphone = accessibleIcon(SmartphoneIcon);
export const Sparkles = accessibleIcon(SparklesIcon);
export const Sun = accessibleIcon(SunIcon);
export const Trash2 = accessibleIcon(Trash2Icon);
export const Upload = accessibleIcon(UploadIcon);
export const User = accessibleIcon(UserIcon);
export const Users = accessibleIcon(UsersIcon);
export const Video = accessibleIcon(VideoIcon);
export const Volume2 = accessibleIcon(Volume2Icon);
export const VolumeX = accessibleIcon(VolumeXIcon);
export const WifiOff = accessibleIcon(WifiOffIcon);
export const X = accessibleIcon(XIcon);
export const Zap = accessibleIcon(ZapIcon);

export const AlertCircle = accessibleIcon(InfoIcon);
export const AlertTriangle = accessibleIcon(TriangleAlertIcon);
export const Archive = accessibleIcon(PackageOpenIcon);
export const ArrowLeft = accessibleIcon(MoveLeftIcon);
export const ArrowRight = accessibleIcon(MoveRightIcon);
export const ArrowUp = accessibleIcon(AArrowUpIcon);
export const Bot = accessibleIcon(BrainIcon);
export const BrainCircuit = accessibleIcon(BrainIcon);
export const CheckCircle2 = accessibleIcon(CircleCheckIcon);
export const CircleStop = accessibleIcon(Disc3Icon);
export const Eraser = accessibleIcon(Trash2Icon);
export const Focus = accessibleIcon(ScanIcon);
export const FolderPlus = accessibleIcon(CirclePlusIcon);
export const Globe2 = accessibleIcon(GlobeIcon);
export const Inbox = accessibleIcon(MailsIcon);
export const Languages = accessibleIcon(GlobeIcon);
export const Layers3 = accessibleIcon(LayersIcon);
export const Library = accessibleIcon(BookOpenTextIcon);
export const LineChart = accessibleIcon(ChartLineIcon);
export const Link2 = accessibleIcon(LinkIcon);
export const ListOrdered = accessibleIcon(ListChevronsUpDownIcon);
export const ListVideo = accessibleIcon(VideoIcon);
export const Loader2 = accessibleIcon(LoaderIcon);
export const Maximize2 = accessibleIcon(MoveDiagonal2Icon);
export const MessageSquare = accessibleIcon(MessageCircleIcon);
export const MoreHorizontal = accessibleIcon(EllipsisIcon);
export const Music2 = accessibleIcon(MusicIcon);
export const Network = accessibleIcon(ChartNetworkIcon);
export const Notebook = accessibleIcon(BookOpenTextIcon);
export const NotebookPen = accessibleIcon(BookOpenTextIcon);
export const PanelLeft = accessibleIcon(LayoutListIcon);
export const PanelLeftClose = accessibleIcon(ChevronsLeftIcon);
export const PanelLeftOpen = accessibleIcon(MenuIcon);
export const PlayCircle = accessibleIcon(PlayIcon);
export const Plug = accessibleIcon(WebhookIcon);
export const Puzzle = accessibleIcon(BlocksIcon);
export const RotateCcw = accessibleIcon(RepeatIcon);
export const RotateCw = accessibleIcon(RefreshCwIcon);
export const ShieldAlert = accessibleIcon(TriangleAlertIcon);
export const Square = accessibleIcon(BoxIcon);
export const SquarePlus = accessibleIcon(CirclePlusIcon);
export const Tags = accessibleIcon(BookmarkIcon);
export const Type = accessibleIcon(FileTextIcon);
export const Wand2 = accessibleIcon(SparklesIcon);
export const Workflow = accessibleIcon(GitBranchIcon);
export const Wrench = accessibleIcon(SettingsIcon);
export const XCircle = accessibleIcon(ShieldXIcon);
export const ZoomIn = accessibleIcon(CirclePlusIcon);
export const ZoomOut = accessibleIcon(MinusIcon);
