import {
  AlertCircle,
  AlertTriangle,
  ArrowRightCircle,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Eye,
  FileCheck,
  FileEdit,
  Lock,
  Package,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface ToneConfig {
  tone: Tone;
  icon: LucideIcon;
}

export const MONEY_TONE_MAP: Record<string, ToneConfig> = {
  none: { tone: "neutral", icon: Circle },
  reserving: { tone: "accent", icon: Clock },
  reserved: { tone: "accent", icon: Lock },
  releasing: { tone: "accent", icon: ArrowRightCircle },
  released: { tone: "success", icon: Check },
  returned: { tone: "neutral", icon: RotateCcw },
  attention: { tone: "danger", icon: AlertTriangle },
};

export const STATE_TONE_MAP: Record<string, ToneConfig> = {
  DRAFT: { tone: "neutral", icon: FileEdit },
  CONTRACTED: { tone: "neutral", icon: FileCheck },
  GUARDED: { tone: "success", icon: ShieldCheck },
  FLAGGED: { tone: "danger", icon: ShieldAlert },
  AWAITING_APPROVAL: { tone: "warning", icon: AlertCircle },
  FUNDING: { tone: "accent", icon: Clock },
  LOCKED: { tone: "accent", icon: Lock },
  DELIVERED: { tone: "accent", icon: Package },
  VERIFYING: { tone: "accent", icon: ScanSearch },
  NEEDS_REVIEW: { tone: "warning", icon: Eye },
  RELEASING: { tone: "accent", icon: ArrowRightCircle },
  RELEASED: { tone: "success", icon: CheckCircle2 },
  RELEASED_PARTIAL: { tone: "warning", icon: CheckCircle2 },
  SETTLEMENT_ERROR: { tone: "danger", icon: AlertTriangle },
  VOIDED: { tone: "neutral", icon: RotateCcw },
  CANCELLED: { tone: "neutral", icon: XCircle },
};

export function getMoneyTone(state: string): ToneConfig {
  return MONEY_TONE_MAP[state] ?? { tone: "neutral", icon: Circle };
}

export function getStateTone(state: string): ToneConfig {
  return STATE_TONE_MAP[state] ?? { tone: "neutral", icon: Circle };
}

