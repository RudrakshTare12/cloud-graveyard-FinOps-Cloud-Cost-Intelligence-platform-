'use client';

import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Clock,
  Cloud,
  Copy,
  Cpu,
  Database,
  DollarSign,
  Download,
  Flame,
  Ghost,
  HardDrive,
  Layers,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Scroll,
  Search,
  ShieldAlert,
  ShieldCheck,
  Skull,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

type Status = 'Zombie' | 'Idle' | 'Orphaned' | 'Healthy';
type Kind = 'EC2 Instance' | 'RDS Database' | 'EBS Volume' | 'S3 Bucket';
type Region = 'us-east-1' | 'us-west-2' | 'ap-south-1' | 'eu-central-1';
type RegionFilter = Region | 'All';
type ToastTone = 'blessed' | 'warning' | 'eerie';
type Connection = 'standby' | 'live' | 'simulated';
type Dimension = 'region' | 'kind';
type Cue = 'click' | 'toggle' | 'summon' | 'exorcise' | 'success' | 'warning' | 'open' | 'bat';
type ExorcismMode = 'live' | 'simulated';

interface Asset {
  id: string;
  name: string;
  kind: Kind;
  status: Status;
  region: Region;
  monthlyCost: number;
  lastSeen: string;
  owner: string;
  risk: number;
}

interface AuditEntry {
  seq: number;
  auditId: string;
  resourceId: string;
  resourceName: string;
  reclaimedMonthly: number;
  timestamp: string;
  s3Key: string;
  mode: ExorcismMode;
  checksum: string;
}

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface PurgeResponse {
  auditId: string;
  s3Key: string;
}

interface NewAssetDraft {
  name: string;
  kind: Kind;
  region: Region;
  cost: string;
}

type DraftErrors = Partial<Record<'name' | 'cost', string>>;

interface BreakdownRow {
  label: string;
  amount: number;
  count: number;
  share: number;
}

interface Ritual {
  name: string;
}

interface Tone {
  type: OscillatorType;
  from: number;
  to: number;
  duration: number;
  peak: number;
  delay?: number;
}

interface NoiseSpec {
  from: number;
  to: number;
  duration: number;
  peak: number;
  delay?: number;
}

interface CueSpec {
  tones: Tone[];
  noise?: NoiseSpec;
}

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };

/* -------------------------------------------------------------------------- */
/*                                  Constants                                 */
/* -------------------------------------------------------------------------- */

const LOG_BUCKET = 'cloud-graveyard-logs';
const LOG_PREFIX = 'crypt/exorcisms';
const SOUND_KEY = 'cg-sound-preference';

const SCAN_MS = 2200;
const CHANT_INTERVAL_MS = 550;
const RITUAL_MS = 1400;
const EXIT_MS = 650;
const TOAST_TTL_MS = 4200;
const PURGE_TIMEOUT_MS = 4000;
const MAX_NAME_LENGTH = 64;
const MAX_COST = 100_000;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const REGIONS: readonly Region[] = ['us-east-1', 'us-west-2', 'ap-south-1', 'eu-central-1'];
const KINDS: readonly Kind[] = ['EC2 Instance', 'RDS Database', 'EBS Volume', 'S3 Bucket'];
const STATUSES: readonly Status[] = ['Zombie', 'Idle', 'Orphaned', 'Healthy'];

const STATUS_LABEL: Record<Status, string> = {
  Zombie: 'Zombies',
  Idle: 'Sleepers',
  Orphaned: 'Wanderers',
  Healthy: 'Living',
};

const SCAN_CHANTS = [
  'Calling the restless spirits…',
  'Dusting off the tombstones…',
  'Counting the cursed resources…',
  'Reading the bone-dry invoices…',
] as const;

const SEED: Asset[] = [
  { id: 'i-0a1b2c3d', name: 'idle-ec2-dev-cluster', kind: 'EC2 Instance', status: 'Zombie', region: 'us-east-1', monthlyCost: 142.5, lastSeen: '18 days ago', owner: 'Platform', risk: 94 },
  { id: 'vol-08f3a1', name: 'unattached-ebs-volume-v1', kind: 'EBS Volume', status: 'Orphaned', region: 'ap-south-1', monthlyCost: 45, lastSeen: '42 days ago', owner: 'Unknown', risk: 88 },
  { id: 'db-test-04', name: 'abandoned-rds-testdb', kind: 'RDS Database', status: 'Zombie', region: 'us-west-2', monthlyCost: 310, lastSeen: '31 days ago', owner: 'QA', risk: 97 },
  { id: 'bucket-temp-9', name: 'legacy-s3-temp-dump', kind: 'S3 Bucket', status: 'Idle', region: 'eu-central-1', monthlyCost: 88.2, lastSeen: '64 days ago', owner: 'Data team', risk: 72 },
  { id: 'i-eks-221', name: 'stale-eks-worker-node', kind: 'EC2 Instance', status: 'Zombie', region: 'us-east-1', monthlyCost: 210, lastSeen: '12 days ago', owner: 'Platform', risk: 91 },
];

const EMPTY_DRAFT: NewAssetDraft = { name: '', kind: 'EC2 Instance', region: 'us-east-1', cost: '100' };

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const money = (value: number): string => usd.format(value);

const STATUS_STYLE: Record<Status, string> = {
  Zombie: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  Idle: 'text-amber-200 bg-amber-400/10 border-amber-400/30',
  Orphaned: 'text-violet-300 bg-violet-500/10 border-violet-400/30',
  Healthy: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30',
};

const STATUS_DOT: Record<Status, string> = {
  Zombie: 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.9)]',
  Idle: 'bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.8)]',
  Orphaned: 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.9)]',
  Healthy: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]',
};

const KIND_ICON: Record<Kind, LucideIcon> = {
  'EC2 Instance': Cpu,
  'RDS Database': Database,
  'EBS Volume': HardDrive,
  'S3 Bucket': Cloud,
};

const CONNECTION_LABEL: Record<Connection, string> = {
  standby: 'Dormant',
  live: 'Live',
  simulated: 'Simulated',
};

const CONNECTION_STYLE: Record<Connection, string> = {
  standby: 'text-slate-300',
  live: 'text-emerald-300',
  simulated: 'text-amber-300',
};

const TOAST_ICON: Record<ToastTone, LucideIcon> = {
  blessed: Sparkles,
  warning: AlertCircle,
  eerie: Ghost,
};

const TOAST_STYLE: Record<ToastTone, string> = {
  blessed: 'border-emerald-500/50 text-emerald-200',
  warning: 'border-rose-500/50 text-rose-200',
  eerie: 'border-violet-400/50 text-violet-200',
};

const CUES: Record<Cue, CueSpec> = {
  click: {
    tones: [{ type: 'sine', from: 880, to: 620, duration: 0.09, peak: 0.07 }],
  },
  toggle: {
    tones: [{ type: 'triangle', from: 440, to: 660, duration: 0.12, peak: 0.06 }],
  },
  summon: {
    tones: [
      { type: 'sine', from: 98, to: 196, duration: 1.4, peak: 0.1 },
      { type: 'sine', from: 147, to: 294, duration: 1.4, peak: 0.05 },
    ],
    noise: { from: 300, to: 2600, duration: 1.4, peak: 0.05 },
  },
  exorcise: {
    tones: [
      { type: 'sawtooth', from: 320, to: 28, duration: 0.95, peak: 0.12 },
      { type: 'square', from: 90, to: 40, duration: 0.95, peak: 0.04 },
    ],
    noise: { from: 2400, to: 180, duration: 0.95, peak: 0.09 },
  },
  success: {
    tones: [
      { type: 'sine', from: 440, to: 440, duration: 0.22, peak: 0.09 },
      { type: 'sine', from: 523, to: 523, duration: 0.22, peak: 0.08, delay: 0.14 },
      { type: 'sine', from: 659, to: 659, duration: 0.38, peak: 0.08, delay: 0.28 },
    ],
  },
  warning: {
    tones: [
      { type: 'sine', from: 150, to: 110, duration: 0.38, peak: 0.14 },
      { type: 'sine', from: 150, to: 110, duration: 0.38, peak: 0.1, delay: 0.42 },
    ],
  },
  open: {
    tones: [{ type: 'sawtooth', from: 80, to: 120, duration: 1.0, peak: 0.03 }],
    noise: { from: 160, to: 620, duration: 1.0, peak: 0.06 },
  },
  bat: {
    tones: [
      { type: 'sine', from: 2400, to: 3200, duration: 0.05, peak: 0.03 },
      { type: 'sine', from: 2800, to: 2000, duration: 0.06, peak: 0.03, delay: 0.08 },
    ],
  },
};

const BATS = [
  { y: '9%', size: '34px', duration: '30s', delay: '-3s' },
  { y: '24%', size: '22px', duration: '38s', delay: '-18s' },
  { y: '4%', size: '18px', duration: '46s', delay: '-31s' },
] as const;

/* -------------------------------------------------------------------------- */
/*                               Global styles                                */
/* -------------------------------------------------------------------------- */

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Creepster&family=Nosifer&family=Share+Tech+Mono&display=swap');

.cg-root { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.cg-mono { font-family: 'Share Tech Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.cg-title {
  font-family: 'Creepster', 'Impact', cursive;
  letter-spacing: 0.04em;
  text-shadow: 0 0 14px rgba(16,185,129,0.55), 0 0 36px rgba(16,185,129,0.22), 0 3px 0 #052e1c;
}
.cg-blood {
  font-family: 'Nosifer', 'Impact', cursive;
  text-shadow: 0 0 12px rgba(244,63,94,0.5);
}

.cg-glass {
  background: linear-gradient(150deg, rgba(15,23,42,0.78), rgba(2,6,23,0.62));
  -webkit-backdrop-filter: blur(16px) saturate(120%);
  backdrop-filter: blur(16px) saturate(120%);
  border: 1px solid rgba(51,65,85,0.55);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 60px -30px rgba(0,0,0,0.85);
}
.cg-card { transition: transform 0.25s cubic-bezier(0.22,1,0.36,1), border-color 0.25s ease, box-shadow 0.25s ease; }
.cg-card:hover {
  transform: translateY(-3px);
  border-color: rgba(244,63,94,0.35);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 50px -20px rgba(244,63,94,0.45), 0 0 0 1px rgba(16,185,129,0.06);
}

.cg-tombstone { border-radius: 50% 50% 8px 8px / 28% 28% 8px 8px; }

.cg-fog {
  position: fixed;
  inset: -20%;
  pointer-events: none;
  background:
    radial-gradient(ellipse 60% 35% at 30% 92%, rgba(16,185,129,0.14), transparent 70%),
    radial-gradient(ellipse 50% 30% at 78% 88%, rgba(244,63,94,0.12), transparent 70%),
    radial-gradient(ellipse 70% 25% at 50% 60%, rgba(139,92,246,0.06), transparent 70%);
  animation: cg-fog 22s ease-in-out infinite alternate;
}
.cg-vignette {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.78) 100%);
}
.cg-moon {
  position: fixed;
  top: 6vh;
  right: 8vw;
  width: 150px;
  height: 150px;
  border-radius: 9999px;
  background:
    radial-gradient(circle at 30% 30%, rgba(241,245,249,0.9) 0%, rgba(203,213,225,0.55) 30%, rgba(100,116,139,0.25) 60%, transparent 72%);
  box-shadow: 0 0 90px 20px rgba(226,232,240,0.1), 0 0 180px 70px rgba(16,185,129,0.07);
  pointer-events: none;
  animation: cg-breathe 9s ease-in-out infinite;
}

.cg-bat {
  position: fixed;
  top: var(--y);
  left: -80px;
  width: var(--s);
  height: var(--s);
  color: rgba(226,232,240,0.28);
  pointer-events: none;
  animation: cg-bat-fly var(--d) linear infinite;
  animation-delay: var(--delay);
}
.cg-bat svg { animation: cg-bob 0.5s ease-in-out infinite alternate; }

.cg-float { animation: cg-float 7s ease-in-out infinite; }
.cg-jack { animation: cg-flicker 2.6s ease-in-out infinite; }
.cg-flame { animation: cg-flicker 1.4s ease-in-out infinite; }
.cg-ritual-spin { animation: cg-spin 9s linear infinite; transform-origin: 50% 50%; }
.cg-ritual-pulse { animation: cg-pulse 1.4s ease-in-out infinite; transform-origin: 50% 50%; }
.cg-rise { animation: cg-rise 2.2s ease-in infinite; }

.cg-exorcise { animation: cg-exorcise 0.65s ease-in forwards; pointer-events: none; }
.cg-shimmer {
  background-color: rgba(30,41,59,0.5);
  background-image: linear-gradient(100deg, transparent 20%, rgba(244,63,94,0.12) 50%, transparent 80%);
  background-size: 200% 100%;
  animation: cg-shimmer 1.6s linear infinite;
}
.cg-scanline {
  background: linear-gradient(180deg, transparent, rgba(16,185,129,0.16), transparent);
  animation: cg-scan 1.6s ease-in-out infinite;
}
.cg-thunder {
  position: fixed;
  inset: 0;
  z-index: 70;
  pointer-events: none;
  background: radial-gradient(circle at 50% 40%, rgba(226,232,240,0.28), rgba(16,185,129,0.1) 50%, transparent 75%);
  animation: cg-thunder 0.75s ease-out forwards;
  opacity: 0;
}
.cg-fade-in { animation: cg-fade-in 0.22s ease-out both; }
.cg-fade-up { animation: cg-fade-up 0.3s cubic-bezier(0.22,1,0.36,1) both; }
.cg-slide-in { animation: cg-slide-in 0.3s cubic-bezier(0.22,1,0.36,1) both; }
.cg-shake { animation: cg-shake 0.5s linear; }

@keyframes cg-fog { from { transform: translate3d(-3%,0,0); } to { transform: translate3d(3%,-2%,0); } }
@keyframes cg-breathe { 0%,100% { opacity: 0.45; } 50% { opacity: 0.7; } }
@keyframes cg-bat-fly { from { transform: translateX(0); } to { transform: translateX(calc(100vw + 180px)); } }
@keyframes cg-bob { from { transform: translateY(0) scaleY(1); } to { transform: translateY(-4px) scaleY(0.82); } }
@keyframes cg-float { 0%,100% { transform: translate3d(0,0,0) rotate(-4deg); } 50% { transform: translate3d(0,-14px,0) rotate(4deg); } }
@keyframes cg-flicker {
  0%,100% { opacity: 1; filter: drop-shadow(0 0 6px rgba(251,146,60,0.6)); }
  25% { opacity: 0.82; }
  50% { opacity: 1; filter: drop-shadow(0 0 12px rgba(251,146,60,0.9)); }
  75% { opacity: 0.9; }
}
@keyframes cg-spin { to { transform: rotate(360deg); } }
@keyframes cg-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
@keyframes cg-rise {
  0% { transform: translateY(24px); opacity: 0; }
  25% { opacity: 0.95; }
  100% { transform: translateY(-44px); opacity: 0; }
}
@keyframes cg-exorcise {
  0% { background-color: rgba(244,63,94,0.2); opacity: 1; }
  60% { background-color: rgba(244,63,94,0.28); opacity: 0.6; }
  100% { background-color: rgba(244,63,94,0.05); opacity: 0; }
}
@keyframes cg-shimmer { from { background-position: 150% 0; } to { background-position: -50% 0; } }
@keyframes cg-scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(500%); } }
@keyframes cg-thunder {
  0% { opacity: 0; }
  8% { opacity: 1; }
  16% { opacity: 0.2; }
  26% { opacity: 0.8; }
  100% { opacity: 0; }
}
@keyframes cg-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cg-fade-up { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes cg-slide-in { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes cg-shake {
  10%, 90% { transform: translate3d(-1px,0,0); }
  20%, 80% { transform: translate3d(2px,0,0); }
  30%, 50%, 70% { transform: translate3d(-4px,0,0); }
  40%, 60% { transform: translate3d(4px,0,0); }
}

@media (prefers-reduced-motion: reduce) {
  .cg-root *, .cg-root *::before, .cg-root *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
  .cg-bat { display: none; }
}
`;

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

/** Non-cryptographic FNV-1a digest used as a tamper-evidence hint in the crypt. */
const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const cssVars = (vars: Record<string, string>): React.CSSProperties => vars as React.CSSProperties;

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });

const searchHaystack = (asset: Asset): string =>
    `${asset.name} ${asset.id} ${asset.region} ${asset.kind} ${asset.owner}`.toLowerCase();

const sumCost = (assets: readonly Asset[]): number =>
    assets.reduce((total, asset) => total + asset.monthlyCost, 0);

function buildBreakdown(assets: readonly Asset[], by: Dimension): BreakdownRow[] {
  const total = sumCost(assets);
  const groups = new Map<string, { amount: number; count: number }>();

  for (const asset of assets) {
    const label = by === 'region' ? asset.region : asset.kind;
    const group = groups.get(label) ?? { amount: 0, count: 0 };
    group.amount += asset.monthlyCost;
    group.count += 1;
    groups.set(label, group);
  }

  return [...groups.entries()]
      .map(([label, group]) => ({
        label,
        amount: group.amount,
        count: group.count,
        share: total > 0 ? group.amount / total : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
}

function validateDraft(draft: NewAssetDraft): DraftErrors {
  const errors: DraftErrors = {};
  const name = draft.name.trim();

  if (!name) {
    errors.name = 'A tombstone needs a name.';
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `Keep the epitaph under ${MAX_NAME_LENGTH} characters.`;
  } else if (!NAME_PATTERN.test(name)) {
    errors.name = 'Use letters, numbers, dots, dashes or underscores.';
  }

  const cost = Number(draft.cost);
  if (draft.cost.trim() === '' || !Number.isFinite(cost)) {
    errors.cost = 'Enter a numeric monthly curse.';
  } else if (cost < 0 || cost > MAX_COST) {
    errors.cost = `The curse must be between $0 and ${money(MAX_COST)}.`;
  }

  return errors;
}

const isPurgeResponse = (value: unknown): value is PurgeResponse =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PurgeResponse).auditId === 'string' &&
    typeof (value as PurgeResponse).s3Key === 'string';

/**
 * Calls the exorcism backend. Any non-2xx response, timeout, network failure
 * or malformed payload throws, and the caller falls back to spirit (simulated) mode.
 */
async function postPurge(asset: Asset): Promise<PurgeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PURGE_TIMEOUT_MS);

  try {
    const response = await fetch('/api/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceId: asset.id,
        resourceName: asset.name,
        kind: asset.kind,
        region: asset.region,
        monthlyCost: asset.monthlyCost,
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Exorcism API responded with ${response.status}`);

    const payload: unknown = await response.json();
    if (!isPurgeResponse(payload)) throw new Error('Malformed exorcism response');
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

/* -------------------------------------------------------------------------- */
/*                         Sound engine (Web Audio API)                       */
/* -------------------------------------------------------------------------- */

function scheduleTone(ctx: AudioContext, tone: Tone, base: number): void {
  const start = base + (tone.delay ?? 0);
  const end = start + tone.duration;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = tone.type;
  osc.frequency.setValueAtTime(tone.from, start);
  osc.frequency.exponentialRampToValueAtTime(tone.to, end);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(tone.peak, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
  osc.start(start);
  osc.stop(end + 0.02);
}

/** Band-passed noise sweep, used for wind, creaks and the exorcism rush. */
function scheduleNoise(ctx: AudioContext, noise: NoiseSpec, base: number): void {
  const start = base + (noise.delay ?? 0);
  const end = start + noise.duration;
  const length = Math.max(1, Math.ceil(ctx.sampleRate * noise.duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 3;
  filter.frequency.setValueAtTime(noise.from, start);
  filter.frequency.exponentialRampToValueAtTime(noise.to, end);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(noise.peak, start + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  source.start(start);
  source.stop(end + 0.02);
}

/** One lazily created AudioContext, reused for every cue and closed on unmount. */
function useSoundEngine(enabled: boolean): (cue: Cue) => void {
  const ctxRef = useRef<AudioContext | null>(null);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    return () => {
      const ctx = ctxRef.current;
      ctxRef.current = null;
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    };
  }, []);

  return useCallback((cue: Cue) => {
    if (!enabledRef.current || typeof window === 'undefined') return;

    try {
      if (!ctxRef.current) {
        const Ctor: typeof AudioContext | undefined =
            window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
        if (!Ctor) return;
        ctxRef.current = new Ctor();
      }

      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

      const spec = CUES[cue];
      const now = ctx.currentTime;
      spec.tones.forEach((tone) => scheduleTone(ctx, tone, now));
      if (spec.noise) scheduleNoise(ctx, spec.noise, now);
    } catch {
      // Audio is decorative. It must never break the interface.
    }
  }, []);
}

/* -------------------------------------------------------------------------- */
/*                              Toast notifications                           */
/* -------------------------------------------------------------------------- */

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
      (tone: ToastTone, message: string) => {
        nextId.current += 1;
        const id = nextId.current;
        setToasts((current) => [...current.slice(-2), { id, tone, message }]);
        timers.current.set(id, setTimeout(() => dismiss(id), TOAST_TTL_MS));
      },
      [dismiss],
  );

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  return { toasts, notify, dismiss };
}

/* -------------------------------------------------------------------------- */
/*                               Decorative art                               */
/* -------------------------------------------------------------------------- */

function Bat({ className = '' }: { className?: string }) {
  return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <path d="M12 8C10 5 7 4 4 4.5L1 3l1.5 5c-.5 1-.5 2 0 3h4.5c1 2 2.5 3.5 5 3.5s4-1.5 5-3.5h4.5c.5-1 .5-2 0-3L23 3l-3 1.5C17 4 14 5 12 8z" />
      </svg>
  );
}

function JackOLantern({ className = '' }: { className?: string }) {
  return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        <defs>
          <radialGradient id="cg-pumpkin" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#7c2d12" />
          </radialGradient>
        </defs>
        <path d="M22 9 L24 3.5 L27 9 Z" fill="#365314" />
        <ellipse cx="24" cy="27" rx="19" ry="17" fill="url(#cg-pumpkin)" />
        <path d="M24 10 Q14 27 24 44 M24 10 Q34 27 24 44" stroke="#7c2d12" strokeWidth="1.1" fill="none" opacity="0.55" />
        <path d="M12.5 21.5 L19.5 25 L12.5 28.5 Z" fill="#fef08a" />
        <path d="M35.5 21.5 L28.5 25 L35.5 28.5 Z" fill="#fef08a" />
        <path d="M24 30.5 L20.8 35 L27.2 35 Z" fill="#fef08a" />
        <path d="M13.5 37.5 Q24 32 34.5 37.5 L33 40.5 Q24 36.5 15 40.5 Z" fill="#fef08a" />
      </svg>
  );
}

function CobWeb({ className = '' }: { className?: string }) {
  return (
      <svg
          viewBox="0 0 120 120"
          className={className}
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
      >
        <path d="M0 0 L120 0 M0 0 L0 120 M0 0 L120 120 M0 0 L92 120 M0 0 L120 60 M0 0 L60 120" />
        <path d="M0 22 Q22 22 22 0 M0 46 Q46 46 46 0 M0 72 Q72 72 72 0 M0 98 Q98 98 98 0" />
      </svg>
  );
}

function BatSwarm() {
  return (
      <>
        {BATS.map((bat) => (
            <span
                key={bat.y}
                aria-hidden="true"
                className="cg-bat"
                style={cssVars({ '--y': bat.y, '--s': bat.size, '--d': bat.duration, '--delay': bat.delay })}
            >
          <Bat className="h-full w-full" />
        </span>
        ))}
      </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 UI pieces                                  */
/* -------------------------------------------------------------------------- */

function Modal({
                 open,
                 onClose,
                 labelledBy,
                 widthClass = 'max-w-md',
                 accent = 'emerald',
                 children,
               }: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  widthClass?: string;
  accent?: 'emerald' | 'rose' | 'violet';
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  const ring = {
    emerald: 'border-emerald-500/40 shadow-[0_0_70px_-12px_rgba(16,185,129,0.4)]',
    rose: 'border-rose-500/40 shadow-[0_0_70px_-12px_rgba(244,63,94,0.45)]',
    violet: 'border-violet-400/40 shadow-[0_0_70px_-12px_rgba(167,139,250,0.4)]',
  }[accent];

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
            aria-hidden="true"
            onClick={() => onCloseRef.current()}
            className="cg-fade-in absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
        />
        <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            tabIndex={-1}
            className={`cg-glass cg-fade-up relative max-h-[88vh] w-full ${widthClass} overflow-y-auto rounded-2xl border p-6 focus:outline-none ${ring}`}
        >
          {children}
        </div>
      </div>
  );
}

function RitualOverlay({ name }: { name: string }) {
  return (
      <div
          role="status"
          aria-live="assertive"
          className="cg-fade-in fixed inset-0 z-[65] flex flex-col items-center justify-center bg-slate-950/88 backdrop-blur-sm"
      >
        <div className="relative h-56 w-56">
          <svg
              viewBox="0 0 100 100"
              aria-hidden="true"
              className="cg-ritual-spin absolute inset-0 h-full w-full text-rose-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
          >
            <circle cx="50" cy="50" r="46" />
            <circle cx="50" cy="50" r="38" strokeDasharray="2 4" />
            <polygon points="50,8 75,84 10,37 90,37 25,84" className="cg-ritual-pulse" />
          </svg>
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <Ghost className="cg-rise h-12 w-12 text-emerald-300" />
          </div>
        </div>
        <p className="cg-blood mt-8 text-2xl text-rose-400">Exorcism in progress</p>
        <p className="cg-mono mt-2 text-xs text-slate-400">
          Binding <span className="text-slate-200">{name}</span> to the crypt…
        </p>
      </div>
  );
}

function WasteBreakdown({
                          rows,
                          dimension,
                          onDimensionChange,
                        }: {
  rows: BreakdownRow[];
  dimension: Dimension;
  onDimensionChange: (next: Dimension) => void;
}) {
  return (
      <section aria-labelledby="breakdown-title" className="cg-glass cg-card relative overflow-hidden rounded-2xl p-5">
        <CobWeb className="pointer-events-none absolute -right-2 -top-2 h-28 w-28 rotate-90 text-slate-300 opacity-15 transition-opacity duration-500 group-hover:opacity-35" />
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="breakdown-title" className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Haunted distribution
            </h2>
            <p className="mt-1 text-[11px] text-slate-500">
              Share of the monthly curse by {dimension === 'region' ? 'haunt site (region)' : 'soul type (service)'}
            </p>
          </div>

          <div role="group" aria-label="Group curse by" className="inline-flex self-start rounded-lg border border-slate-800 bg-slate-950/70 p-0.5">
            {(['region', 'kind'] as const).map((option) => (
                <button
                    key={option}
                    type="button"
                    aria-pressed={dimension === option}
                    onClick={() => onDimensionChange(option)}
                    className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 ${
                        dimension === option ? 'bg-rose-500/20 text-rose-200' : 'text-slate-400 hover:text-slate-200'
                    }`}
                >
                  {option === 'region' ? 'By haunt site' : 'By soul type'}
                </button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">The graveyard is quiet. No curses to measure.</p>
        ) : (
            <ul className="space-y-4">
              {rows.map((row, index) => (
                  <li key={row.label} className="cg-fade-up" style={{ animationDelay: `${index * 70}ms` }}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                <span className="cg-mono text-slate-200">
                  {row.label}
                  <span className="ml-2 text-[10px] text-slate-500">
                    {row.count} soul{row.count === 1 ? '' : 's'}
                  </span>
                </span>
                      <span className="cg-mono text-slate-400">
                  <span className="text-rose-300">{money(row.amount)}</span> · {(row.share * 100).toFixed(1)}%
                </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-800/80" aria-hidden="true">
                      <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 via-rose-500 to-amber-300 shadow-[0_0_12px_rgba(244,63,94,0.55)] transition-[width] duration-700 ease-out"
                          style={{ width: `${Math.max(row.share * 100, 2)}%` }}
                      />
                    </div>
                  </li>
              ))}
            </ul>
        )}
      </section>
  );
}

function RegionGraveyards({ assets }: { assets: readonly Asset[] }) {
  const totals = REGIONS.map((region) => {
    const inRegion = assets.filter((asset) => asset.region === region);
    return { region, count: inRegion.length, amount: sumCost(inRegion) };
  });

  return (
      <section aria-labelledby="graveyard-title" className="cg-glass cg-card relative overflow-hidden rounded-2xl p-5">
        <h2 id="graveyard-title" className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Graveyards by region
        </h2>
        <p className="mt-1 text-[11px] text-slate-500">Tombstones glow where curses are active.</p>

        <ul className="mt-5 grid grid-cols-2 gap-3">
          {totals.map(({ region, count, amount }) => (
              <li
                  key={region}
                  className={`cg-tombstone flex min-h-[150px] flex-col items-center justify-end gap-1 border px-2 pb-3 pt-8 text-center transition-all duration-500 ${
                      count > 0
                          ? 'border-rose-500/40 bg-rose-950/30 shadow-[0_0_24px_-6px_rgba(244,63,94,0.5)]'
                          : 'border-slate-800 bg-slate-950/60 opacity-50'
                  }`}
              >
                <span className="cg-title text-lg leading-none text-slate-200">R.I.P.</span>
                <span className="cg-mono text-[10px] text-slate-400">{region}</span>
                <span className="cg-mono text-xs font-bold text-cyan-300">
              {count} soul{count === 1 ? '' : 's'}
            </span>
                <span className="cg-mono text-[10px] text-rose-300">{money(amount)}/mo</span>
              </li>
          ))}
        </ul>
      </section>
  );
}

function RiskMeter({ risk }: { risk: number }) {
  const tone = risk >= 90 ? 'from-rose-600 to-rose-300' : risk >= 80 ? 'from-amber-500 to-rose-400' : 'from-amber-300 to-amber-200';
  return (
      <div className="flex items-center gap-2">
        <div
            role="meter"
            aria-label="Haunt level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={risk}
            className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800"
        >
          <div
              className={`h-full rounded-full bg-gradient-to-r ${tone} transition-[width] duration-700 ease-out`}
              style={{ width: `${risk}%` }}
          />
        </div>
        <span className="cg-mono text-xs text-slate-400">{risk}</span>
      </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return (
      <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${STATUS_STYLE[status]}`}
      >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
        {STATUS_LABEL[status]}
    </span>
  );
}

function MetricCard({
                      label,
                      icon: Icon,
                      iconClass,
                      value,
                      valueClass,
                      hint,
                    }: {
  label: string;
  icon: LucideIcon;
  iconClass: string;
  value: string;
  valueClass: string;
  hint: string;
}) {
  return (
      <div className="cg-glass cg-card group relative overflow-hidden rounded-2xl p-5">
        <CobWeb className="pointer-events-none absolute -right-3 -top-3 h-24 w-24 rotate-45 text-slate-300 opacity-10 transition-opacity duration-500 group-hover:opacity-30" />
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
          <span>{label}</span>
          <Icon className={`h-4 w-4 ${iconClass}`} aria-hidden="true" />
        </div>
        <div className={`cg-mono mt-3 text-2xl font-bold md:text-3xl ${valueClass}`}>{value}</div>
        <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
      </div>
  );
}

function PurgeButton({
                       name,
                       busy,
                       disabled,
                       onClick,
                       fullWidth = false,
                     }: {
  name: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  fullWidth?: boolean;
}) {
  return (
      <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={`Exorcise ${name}`}
          className={`flex items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3.5 py-2 text-xs font-semibold text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.15)] transition-all hover:border-rose-500 hover:bg-rose-600 hover:text-white hover:shadow-[0_0_22px_rgba(244,63,94,0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-rose-950/40 ${
              fullWidth ? 'w-full' : 'ml-auto'
          }`}
      >
        {busy ? (
            <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
        ) : (
            <Skull className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {busy ? 'Binding…' : 'Exorcise'}
      </button>
  );
}

function SkeletonRows() {
  return (
      <>
        {[0, 1, 2, 3].map((i) => (
            <tr key={`skeleton-${i}`} aria-hidden="true">
              <td colSpan={6} className="px-4 py-4">
                <div className="cg-shimmer h-12 rounded-xl" />
              </td>
            </tr>
        ))}
      </>
  );
}

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Ghost className="cg-float h-10 w-10 text-emerald-400/60" aria-hidden="true" />
        {hasFilters ? (
            <>
              <p className="cg-mono text-xs text-slate-400">No spirits answer to these filters.</p>
              <button
                  type="button"
                  onClick={onClear}
                  className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10"
              >
                Lift the curse (clear filters)
              </button>
            </>
        ) : (
            <>
              <p className="cg-title text-3xl text-emerald-300">Silence in the graveyard</p>
              <p className="cg-mono text-xs text-slate-400">Every soul has been laid to rest.</p>
            </>
        )}
      </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Main page                                  */
/* -------------------------------------------------------------------------- */

export default function CloudGraveyardDashboard() {
  // Data
  const [assets, setAssets] = useState<Asset[]>(SEED);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  // Filters
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [statusFilters, setStatusFilters] = useState<ReadonlySet<Status>>(() => new Set());
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('All');
  const [breakdownBy, setBreakdownBy] = useState<Dimension>('region');

  // Operation state
  const [scanning, setScanning] = useState(false);
  const [chantIndex, setChantIndex] = useState(0);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [exitingIds, setExitingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [ritual, setRitual] = useState<Ritual | null>(null);
  const [connection, setConnection] = useState<Connection>('standby');
  const [flashKey, setFlashKey] = useState(0);

  // Modals and drafts
  const [pendingPurge, setPendingPurge] = useState<Asset | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showVault, setShowVault] = useState(false);
  const [draft, setDraft] = useState<NewAssetDraft>(EMPTY_DRAFT);
  const [draftSubmitted, setDraftSubmitted] = useState(false);

  // Preferences
  const [soundEnabled, setSoundEnabled] = useState(true);

  const searchRef = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chantTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const play = useSoundEngine(soundEnabled);
  const { toasts, notify, dismiss } = useToasts();

  // Restore the sound preference after hydration to avoid a server/client mismatch.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SOUND_KEY) === 'off') setSoundEnabled(false);
    } catch {
      // Storage can be blocked. Keep the defaults.
    }
  }, []);

  // Cancel pending timers on unmount.
  useEffect(() => {
    return () => {
      if (scanTimer.current) clearTimeout(scanTimer.current);
      if (chantTimer.current) clearInterval(chantTimer.current);
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);

  const anyModalOpen = showAddModal || showVault || pendingPurge !== null || ritual !== null;

  // "/" summons the search, unless the user is typing or a modal is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || anyModalOpen) return;
      const target = event.target as HTMLElement | null;
      if (
          target &&
          (target.tagName === 'INPUT' ||
              target.tagName === 'TEXTAREA' ||
              target.tagName === 'SELECT' ||
              target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      play('bat');
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyModalOpen, play]);

  /* ----------------------------- Derived data ----------------------------- */

  const sortedAssets = useMemo(
      () => [...assets].sort((a, b) => b.monthlyCost - a.monthlyCost),
      [assets],
  );

  const visibleAssets = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    return sortedAssets.filter((asset) => {
      if (statusFilters.size > 0 && !statusFilters.has(asset.status)) return false;
      if (regionFilter !== 'All' && asset.region !== regionFilter) return false;
      return !term || searchHaystack(asset).includes(term);
    });
  }, [sortedAssets, deferredQuery, statusFilters, regionFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<Status, number> = { Zombie: 0, Idle: 0, Orphaned: 0, Healthy: 0 };
    for (const asset of assets) counts[asset.status] += 1;
    return counts;
  }, [assets]);

  const wasteAssets = useMemo(() => assets.filter((asset) => asset.status !== 'Healthy'), [assets]);
  const visibleWaste = useMemo(
      () => sumCost(visibleAssets.filter((asset) => asset.status !== 'Healthy')),
      [visibleAssets],
  );
  const monthlyWaste = useMemo(() => sumCost(wasteAssets), [wasteAssets]);
  const breakdownRows = useMemo(() => buildBreakdown(wasteAssets, breakdownBy), [wasteAssets, breakdownBy]);

  const zombieCount = statusCounts.Zombie;
  const highRiskCount = wasteAssets.filter((asset) => asset.risk >= 85).length;
  const annualDrain = monthlyWaste * 12;
  const realizedMonthly = useMemo(
      () => auditLog.reduce((total, entry) => total + entry.reclaimedMonthly, 0),
      [auditLog],
  );

  const activeFilterCount =
      statusFilters.size + (regionFilter !== 'All' ? 1 : 0) + (query.trim() ? 1 : 0);

  const draftErrors = useMemo<DraftErrors>(
      () => (draftSubmitted ? validateDraft(draft) : {}),
      [draft, draftSubmitted],
  );

  /* -------------------------------- Actions ------------------------------- */

  const toggleStatus = (status: Status) => {
    play('toggle');
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const clearFilters = () => {
    play('click');
    setQuery('');
    setStatusFilters(new Set());
    setRegionFilter('All');
  };

  const runScan = () => {
    if (scanning) return;
    play('summon');
    setScanning(true);
    setChantIndex(0);
    chantTimer.current = setInterval(
        () => setChantIndex((index) => (index + 1) % SCAN_CHANTS.length),
        CHANT_INTERVAL_MS,
    );
    scanTimer.current = setTimeout(() => {
      scanTimer.current = null;
      if (chantTimer.current) {
        clearInterval(chantTimer.current);
        chantTimer.current = null;
      }
      setScanning(false);
      setLastScan(new Date());
      setFlashKey((key) => key + 1);
      play('success');
      notify('blessed', `Séance complete. ${assets.length} souls re-examined.`);
    }, SCAN_MS);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try {
      window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
    } catch {
      // Ignore persistence failures.
    }
    notify('eerie', next ? 'The spirits can speak again.' : 'The spirits have been silenced.');
  };

  const openPurgeConfirm = (asset: Asset) => {
    play('click');
    setPendingPurge(asset);
  };

  const executePurge = useCallback(
      async (target: Asset) => {
        setPendingPurge(null);
        setPurgingId(target.id);
        setRitual({ name: target.name });
        play('exorcise');

        const timestamp = new Date().toISOString();
        const stamp = timestamp.replace(/[:.]/g, '-');

        const attempt = postPurge(target).then(
            (remote) => ({ auditId: remote.auditId, s3Key: remote.s3Key, mode: 'live' as const }),
            () => ({
              auditId: `sim-${stamp}-${target.id}`,
              s3Key: `${LOG_PREFIX}/${stamp}-${target.id}.json`,
              mode: 'simulated' as const,
            }),
        );

        // The ritual runs for a minimum duration so the feedback is never a flicker.
        const [result] = await Promise.all([attempt, wait(RITUAL_MS)]);

        setConnection(result.mode === 'live' ? 'live' : 'simulated');
        if (result.mode === 'simulated') {
          notify('warning', 'The spirit link is down. Sealed in simulation mode instead.');
        }

        const record = {
          auditId: result.auditId,
          resourceId: target.id,
          resourceName: target.name,
          reclaimedMonthly: target.monthlyCost,
          timestamp,
          s3Key: result.s3Key,
          mode: result.mode,
        };

        setAuditLog((prev) => [
          { ...record, seq: prev.length + 1, checksum: fnv1a(JSON.stringify(record)) },
          ...prev,
        ]);

        setRitual(null);
        setExitingIds((prev) => new Set(prev).add(target.id));
        setFlashKey((key) => key + 1);
        play('success');
        notify('blessed', `${target.name} has been exorcised. ${money(target.monthlyCost)}/mo of curse lifted.`);

        exitTimer.current = setTimeout(() => {
          exitTimer.current = null;
          setAssets((current) => current.filter((asset) => asset.id !== target.id));
          setExitingIds((prev) => {
            const next = new Set(prev);
            next.delete(target.id);
            return next;
          });
          setPurgingId(null);
        }, EXIT_MS);
      },
      [play, notify],
  );

  const closeAddModal = useCallback(() => {
    setShowAddModal(false);
    setDraftSubmitted(false);
  }, []);

  const openAddModal = () => {
    play('click');
    setShowAddModal(true);
  };

  const openVault = () => {
    play('open');
    setShowVault(true);
  };

  const submitDraft = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDraftSubmitted(true);

    if (Object.keys(validateDraft(draft)).length > 0) {
      play('warning');
      notify('warning', 'The spirits reject this epitaph. Fix the marked fields.');
      return;
    }

    const created: Asset = {
      id: `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: draft.name.trim(),
      kind: draft.kind,
      region: draft.region,
      status: 'Zombie',
      monthlyCost: Number(draft.cost),
      lastSeen: 'Just now',
      owner: 'SecOps',
      risk: 95,
    };

    setAssets((current) => [created, ...current]);
    setDraft(EMPTY_DRAFT);
    setDraftSubmitted(false);
    setShowAddModal(false);
    play('summon');
    notify('eerie', `Tombstone raised for ${created.name}. It now haunts the graveyard.`);
  };

  const exportVault = () => {
    play('click');
    const payload = {
      bucket: LOG_BUCKET,
      prefix: LOG_PREFIX,
      exportedAt: new Date().toISOString(),
      records: auditLog,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cloud-graveyard-grimoire-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    notify('blessed', `Grimoire exported. ${auditLog.length} record${auditLog.length === 1 ? '' : 's'} bound.`);
  };

  const copyKey = async (key: string) => {
    play('click');
    try {
      await navigator.clipboard.writeText(key);
      notify('blessed', 'Spirit key copied to the grimoire.');
    } catch {
      notify('warning', 'The clipboard is sealed in this browser context.');
    }
  };

  /* --------------------------------- Render ------------------------------- */

  return (
      <div className="cg-root relative min-h-screen overflow-x-hidden bg-[#04060a] p-5 text-slate-100 md:p-10">
        <style>{GLOBAL_CSS}</style>

        {/* Atmosphere */}
        <div aria-hidden="true" className="cg-fog" />
        <div aria-hidden="true" className="cg-moon" />
        <div aria-hidden="true" className="cg-vignette" />
        <BatSwarm />
        <CobWeb className="pointer-events-none fixed left-0 top-0 h-52 w-52 text-slate-300 opacity-15" />
        <CobWeb className="pointer-events-none fixed bottom-0 right-0 h-64 w-64 rotate-180 text-slate-300 opacity-15" />
        <Ghost aria-hidden="true" className="cg-float pointer-events-none fixed bottom-24 left-6 hidden h-10 w-10 text-emerald-300/20 md:block" />
        <Ghost aria-hidden="true" className="cg-float pointer-events-none fixed right-10 top-1/3 hidden h-14 w-14 text-violet-300/15 md:block [animation-delay:-3s]" />

        {/* Séance flash */}
        {flashKey > 0 && <div key={flashKey} aria-hidden="true" className="cg-thunder" />}

        {/* Toasts */}
        <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
        >
          {toasts.map((toast) => {
            const Icon = TOAST_ICON[toast.tone];
            return (
                <div
                    key={toast.id}
                    className={`cg-slide-in pointer-events-auto flex items-center gap-3 rounded-2xl border bg-slate-950/90 px-4 py-3 shadow-2xl backdrop-blur ${TOAST_STYLE[toast.tone]}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1 text-xs font-semibold">{toast.message}</span>
                  <button
                      type="button"
                      onClick={() => dismiss(toast.id)}
                      aria-label="Dismiss notification"
                      className="rounded p-0.5 text-slate-400 transition-colors hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
            );
          })}
        </div>

        <div className="relative z-10 mx-auto max-w-[1500px]">
          {/* Status bar */}
          <div className="mb-6 flex flex-col items-start gap-3 border-b border-slate-800/80 pb-3 text-xs text-slate-400 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="flex items-center gap-2 font-semibold text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              The engine is awake
            </span>
              <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Last séance:{' '}
                <strong className="cg-mono font-normal text-slate-300">
                {lastScan ? lastScan.toLocaleTimeString('en-US', { hour12: false }) : 'never'}
              </strong>
            </span>
              <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              Crypt link:{' '}
                <strong className={`font-semibold ${CONNECTION_STYLE[connection]}`}>{CONNECTION_LABEL[connection]}</strong>
            </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                  type="button"
                  onClick={toggleSound}
                  aria-pressed={soundEnabled}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
              >
                {soundEnabled ? (
                    <Volume2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                    <VolumeX className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                )}
                Ghostly sounds: {soundEnabled ? 'on' : 'off'}
              </button>
              <button
                  type="button"
                  onClick={openVault}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 transition-colors hover:border-rose-500/40 hover:text-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300"
              >
                <Scroll className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                The crypt ({auditLog.length})
              </button>
            </div>
          </div>

          {/* Header */}
          <header className="flex flex-col justify-between gap-6 border-b border-slate-800/80 pb-8 md:flex-row md:items-center">
            <div className="flex min-w-0 items-center gap-5">
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/40 p-3.5 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                <Skull className="h-10 w-10 text-emerald-400 motion-safe:animate-pulse" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="cg-title text-5xl leading-none text-emerald-300 md:text-6xl">CLOUD GRAVEYARD</h1>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                  Hack-to-ween 2026
                </span>
                  <span className="text-xs text-slate-400">
                  FinOps for the undead: find the zombie resources draining your budget, then exorcise them.
                </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <JackOLantern className="cg-jack hidden h-14 w-14 lg:block" />
              <button
                  type="button"
                  onClick={runScan}
                  disabled={scanning}
                  className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-bold text-slate-950 shadow-[0_0_24px_rgba(16,185,129,0.35)] transition-all hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {scanning ? (
                    <RefreshCw className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                    <Flame className="h-4 w-4" aria-hidden="true" />
                )}
                {scanning ? 'The séance is underway…' : 'Hold a séance (scan)'}
              </button>
              <button
                  type="button"
                  onClick={openAddModal}
                  className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-slate-900/80 px-4 py-3 text-xs font-bold text-rose-200 shadow-lg transition-all hover:border-rose-500/60 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Carve a tombstone
              </button>
            </div>
          </header>

          {/* Curse warning */}
          <section
              aria-labelledby="anomaly-title"
              className="cg-glass relative my-6 flex flex-col gap-4 overflow-hidden rounded-2xl border-rose-500/30 bg-gradient-to-r from-rose-950/50 via-slate-900/80 to-slate-900/80 p-5 md:flex-row md:items-center md:justify-between"
          >
            <CobWeb className="pointer-events-none absolute -left-4 -top-4 h-24 w-24 text-rose-200 opacity-10" />
            <div className="flex items-center gap-4">
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5 shadow-[0_0_18px_rgba(244,63,94,0.3)]">
                <ShieldAlert className="h-5 w-5 text-rose-400 motion-safe:animate-pulse" aria-hidden="true" />
              </div>
              <div>
                <h2 id="anomaly-title" className="cg-blood text-sm text-rose-300">
                  Curse warning · cost anomaly intelligence
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  {zombieCount} zombie and {highRiskCount} high-risk soul{highRiskCount === 1 ? '' : 's'} are draining{' '}
                  <span className="font-semibold text-rose-300">{money(monthlyWaste)}</span> from the budget every month.
                </p>
              </div>
            </div>
            <dl className="flex gap-8 md:text-right">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">Annual curse</dt>
                <dd className="cg-mono text-base font-bold text-rose-400">{money(annualDrain)} / yr</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-500">Lifted (annualized)</dt>
                <dd className="cg-mono text-base font-bold text-emerald-400">{money(realizedMonthly * 12)} / yr</dd>
              </div>
            </dl>
          </section>

          {/* Metrics */}
          <div className="my-6 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
                label="Souls under watch"
                icon={Layers}
                iconClass="text-emerald-400"
                value={String(assets.length)}
                valueClass="text-white"
                hint="Multi-cloud inventory"
            />
            <MetricCard
                label="Restless zombies"
                icon={AlertTriangle}
                iconClass="text-rose-400"
                value={String(zombieCount)}
                valueClass="text-rose-400"
                hint="Immediate exorcism advised"
            />
            <MetricCard
                label="Monthly curse"
                icon={DollarSign}
                iconClass="text-amber-300"
                value={money(monthlyWaste)}
                valueClass="text-amber-300"
                hint="Recoverable on exorcism"
            />
            <MetricCard
                label="Lifted this night"
                icon={ShieldCheck}
                iconClass="text-emerald-400"
                value={money(realizedMonthly)}
                valueClass="text-emerald-400"
                hint={`${auditLog.length} exorcism${auditLog.length === 1 ? '' : 's'} sealed · per month`}
            />
          </div>

          {/* Analytics */}
          <div className="mb-6 grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <WasteBreakdown rows={breakdownRows} dimension={breakdownBy} onDimensionChange={setBreakdownBy} />
            </div>
            <RegionGraveyards assets={wasteAssets} />
          </div>

          {/* The graveyard desk */}
          <section
              aria-labelledby="desk-title"
              className="cg-glass group relative overflow-hidden rounded-2xl p-4 md:p-6"
          >
            <CobWeb className="pointer-events-none absolute -right-4 -top-4 h-40 w-40 rotate-90 text-slate-300 opacity-10 transition-opacity duration-500 group-hover:opacity-25" />
            <CobWeb className="pointer-events-none absolute -bottom-6 -left-6 h-40 w-40 text-slate-300 opacity-10 transition-opacity duration-500 group-hover:opacity-25" />

            <div className="mb-6 flex flex-col gap-4 border-b border-slate-800/60 pb-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 id="desk-title" className="cg-title text-3xl text-slate-100">The Graveyard</h2>
                  <p className="text-[11px] text-slate-500">Every resource below is a soul. Exorcise the ones that bleed money.</p>
                </div>

                <div className="relative w-full md:max-w-sm">
                  <label htmlFor="resource-search" className="sr-only">Seek a soul</label>
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                  <input
                      id="resource-search"
                      ref={searchRef}
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Seek a soul by name, ID, owner..."
                      className="w-full rounded-xl border border-slate-800 bg-slate-950/80 py-2.5 pl-10 pr-10 text-xs text-slate-200 placeholder-slate-500 transition-colors focus:border-rose-500/50 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  />
                  <kbd className="cg-mono pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 md:block">
                    /
                  </kbd>
                </div>
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div role="group" aria-label="Filter by spirit state" className="flex flex-wrap gap-2">
                  {STATUSES.map((status) => {
                    const active = statusFilters.has(status);
                    return (
                        <button
                            key={status}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleStatus(status)}
                            className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-bold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 ${
                                active
                                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-200 shadow-[0_0_14px_rgba(244,63,94,0.2)]'
                                    : 'border-slate-800/60 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                            }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
                          {STATUS_LABEL[status]}
                          <span className="cg-mono text-[10px] opacity-70">{statusCounts[status]}</span>
                        </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="region-filter">Filter by graveyard region</label>
                  <select
                      id="region-filter"
                      value={regionFilter}
                      onChange={(event) => setRegionFilter(event.target.value as RegionFilter)}
                      className="cg-mono rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-300 focus:border-rose-500/50 focus:outline-none"
                  >
                    <option value="All">All graveyards</option>
                    {REGIONS.map((region) => (
                        <option key={region} value={region}>{region}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2 text-xs md:flex-row md:items-center md:justify-between">
                <p role="status" aria-live="polite" className="cg-mono flex min-h-[1.25rem] items-center gap-2 text-slate-400">
                  {scanning ? (
                      <>
                        <Flame className="cg-flame h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                        <span className="text-amber-200">{SCAN_CHANTS[chantIndex]}</span>
                      </>
                  ) : (
                      <>
                        Summoned <strong className="font-normal text-slate-200">{visibleAssets.length}</strong> of {assets.length} souls
                        {' · '}
                        <span className="text-rose-300">{money(visibleWaste)}/mo</span> still bleeding
                        {activeFilterCount > 0 && (
                            <span className="text-slate-500">
                        {' '}· {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} active
                      </span>
                        )}
                      </>
                  )}
                </p>
                {activeFilterCount > 0 && (
                    <button
                        type="button"
                        onClick={clearFilters}
                        className="self-start font-semibold text-emerald-400 underline-offset-4 hover:underline md:self-auto"
                    >
                      Lift the curse (clear filters)
                    </button>
                )}
              </div>
            </div>

            {/* Desktop table */}
            <div className="relative hidden overflow-hidden md:block">
              {scanning && <div aria-hidden="true" className="cg-scanline pointer-events-none absolute inset-x-0 top-0 z-10 h-24" />}
              <table className="w-full min-w-[860px] border-collapse text-left">
                <caption className="sr-only">Cloud resources with their haunt level, curse per month and exorcism actions</caption>
                <thead>
                <tr className="border-b border-slate-800/80 text-[11px] uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-3.5 font-semibold">Soul</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Haunt site</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Spirit state</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Haunt level</th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">Curse / mo</th>
                  <th scope="col" className="px-4 py-3.5 text-right font-semibold">Ritual</th>
                </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                {scanning && <SkeletonRows />}
                {!scanning &&
                    visibleAssets.map((asset) => {
                      const Icon = KIND_ICON[asset.kind];
                      const exiting = exitingIds.has(asset.id);
                      return (
                          <tr
                              key={asset.id}
                              className={`group/row transition-colors hover:bg-rose-500/5 ${exiting ? 'cg-exorcise' : ''}`}
                          >
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-3">
                                <div
                                    className="cg-tombstone flex h-11 w-9 shrink-0 items-center justify-center border border-slate-700 bg-slate-950 text-emerald-400 transition-transform duration-300 group-hover/row:scale-105 group-hover/row:shadow-[0_0_16px_rgba(16,185,129,0.35)]"
                                >
                                  <Icon className="h-4 w-4" aria-hidden="true" />
                                </div>
                                <div className="min-w-0">
                                  <div className="cg-mono truncate text-xs text-slate-100">{asset.name}</div>
                                  <div className="cg-mono text-[10px] text-slate-500">
                                    {asset.id} · haunted by {asset.owner}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <p className="text-xs font-semibold text-slate-300">{asset.kind}</p>
                              <p className="cg-mono text-[10px] text-slate-500">{asset.region}</p>
                            </td>
                            <td className="px-4 py-4"><StatusBadge status={asset.status} /></td>
                            <td className="px-4 py-4"><RiskMeter risk={asset.risk} /></td>
                            <td className="cg-mono px-4 py-4 text-sm font-bold text-rose-300">{money(asset.monthlyCost)}</td>
                            <td className="px-4 py-4 text-right">
                              <PurgeButton
                                  name={asset.name}
                                  busy={purgingId === asset.id}
                                  disabled={purgingId !== null || exiting}
                                  onClick={() => openPurgeConfirm(asset)}
                              />
                            </td>
                          </tr>
                      );
                    })}
                {!scanning && visibleAssets.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState hasFilters={activeFilterCount > 0} onClear={clearFilters} />
                      </td>
                    </tr>
                )}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="space-y-3 md:hidden">
              {scanning &&
                  [0, 1, 2].map((i) => (
                      <li key={`skeleton-${i}`} aria-hidden="true" className="cg-shimmer h-32 rounded-2xl" />
                  ))}
              {!scanning &&
                  visibleAssets.map((asset) => {
                    const Icon = KIND_ICON[asset.kind];
                    const exiting = exitingIds.has(asset.id);
                    return (
                        <li
                            key={asset.id}
                            className={`cg-card rounded-2xl border border-slate-800 bg-slate-950/60 p-4 ${exiting ? 'cg-exorcise' : ''}`}
                        >
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="cg-tombstone flex h-11 w-9 shrink-0 items-center justify-center border border-slate-700 bg-slate-950 text-emerald-400">
                                <Icon className="h-4 w-4" aria-hidden="true" />
                              </div>
                              <div className="min-w-0">
                                <p className="cg-mono truncate text-xs text-slate-100">{asset.name}</p>
                                <p className="cg-mono text-[10px] text-slate-500">{asset.kind} · {asset.region}</p>
                              </div>
                            </div>
                            <StatusBadge status={asset.status} />
                          </div>
                          <div className="mb-4 flex items-center justify-between">
                            <RiskMeter risk={asset.risk} />
                            <span className="cg-mono text-sm font-bold text-rose-300">{money(asset.monthlyCost)}</span>
                          </div>
                          <PurgeButton
                              name={asset.name}
                              busy={purgingId === asset.id}
                              disabled={purgingId !== null || exiting}
                              onClick={() => openPurgeConfirm(asset)}
                              fullWidth
                          />
                        </li>
                    );
                  })}
              {!scanning && visibleAssets.length === 0 && (
                  <li>
                    <EmptyState hasFilters={activeFilterCount > 0} onClear={clearFilters} />
                  </li>
              )}
            </ul>
          </section>

          <footer className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-slate-800/60 pt-6 text-[11px] text-slate-600 md:flex-row">
            <span>CloudGraveyard · Hack-to-ween 2026 · IIT Jodhpur</span>
            <span className="cg-mono">Crypt records persist for this session unless the exorcism API is live.</span>
          </footer>
        </div>

        {/* Ritual overlay */}
        {ritual && <RitualOverlay name={ritual.name} />}

        {/* Banish confirmation */}
        <Modal open={pendingPurge !== null} onClose={() => setPendingPurge(null)} labelledBy="purge-title" accent="rose">
          {pendingPurge && (
              <>
                <div className="mb-5 flex items-start gap-4">
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5 shadow-[0_0_18px_rgba(244,63,94,0.3)]">
                    <Skull className="h-5 w-5 text-rose-400" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 id="purge-title" className="cg-title text-3xl text-rose-200">Banish this soul?</h2>
                    <p className="mt-1 text-xs text-slate-400">
                      The resource will be destroyed and a sealed record written to the crypt. This cannot be undone.
                    </p>
                  </div>
                </div>
                <dl className="cg-mono mb-6 space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Soul</dt>
                    <dd className="truncate text-slate-200">{pendingPurge.name}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Haunt site</dt>
                    <dd className="text-slate-200">{pendingPurge.region}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Curse lifted / mo</dt>
                    <dd className="text-rose-300">{money(pendingPurge.monthlyCost)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Haunt level</dt>
                    <dd className="text-amber-300">{pendingPurge.risk}</dd>
                  </div>
                </dl>
                <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
                  <button
                      type="button"
                      onClick={() => setPendingPurge(null)}
                      className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700"
                  >
                    Spare it
                  </button>
                  <button
                      type="button"
                      onClick={() => void executePurge(pendingPurge)}
                      className="flex items-center justify-center gap-2 rounded-xl border border-rose-500 bg-rose-600 px-4 py-2.5 text-xs font-bold text-white shadow-[0_0_20px_rgba(244,63,94,0.45)] transition-colors hover:bg-rose-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Cast the exorcism
                  </button>
                </div>
              </>
          )}
        </Modal>

        {/* Carve a tombstone */}
        <Modal open={showAddModal} onClose={closeAddModal} labelledBy="register-title">
          <div className="mb-5 flex items-center justify-between">
            <h2 id="register-title" className="cg-title flex items-center gap-2 text-3xl text-emerald-200">
              <Plus className="h-5 w-5 text-emerald-400" aria-hidden="true" /> Carve a tombstone
            </h2>
            <button
                type="button"
                onClick={closeAddModal}
                aria-label="Close dialog"
                className="rounded p-1 text-slate-400 transition-colors hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <p className="-mt-3 mb-5 text-xs text-slate-400">Give a forgotten resource its epitaph so the graveyard can watch it.</p>

          <form onSubmit={submitDraft} noValidate className="space-y-4">
            <div>
              <label htmlFor="draft-name" className="mb-1 block text-xs text-slate-400">Epitaph (resource name)</label>
              <input
                  id="draft-name"
                  type="text"
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="e.g. orphan-s3-backup-v2"
                  maxLength={MAX_NAME_LENGTH + 20}
                  aria-invalid={draftErrors.name ? true : undefined}
                  aria-describedby={draftErrors.name ? 'draft-name-error' : undefined}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none aria-[invalid=true]:border-rose-500"
              />
              {draftErrors.name && (
                  <p id="draft-name-error" className="mt-1 text-[11px] text-rose-400">{draftErrors.name}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="draft-kind" className="mb-1 block text-xs text-slate-400">Soul type</label>
                <select
                    id="draft-kind"
                    value={draft.kind}
                    onChange={(event) => setDraft((prev) => ({ ...prev, kind: event.target.value as Kind }))}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  {KINDS.map((kind) => (<option key={kind} value={kind}>{kind}</option>))}
                </select>
              </div>
              <div>
                <label htmlFor="draft-region" className="mb-1 block text-xs text-slate-400">Haunt site (region)</label>
                <select
                    id="draft-region"
                    value={draft.region}
                    onChange={(event) => setDraft((prev) => ({ ...prev, region: event.target.value as Region }))}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  {REGIONS.map((region) => (<option key={region} value={region}>{region}</option>))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="draft-cost" className="mb-1 block text-xs text-slate-400">Monthly curse (USD)</label>
              <input
                  id="draft-cost"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={MAX_COST}
                  step={0.01}
                  value={draft.cost}
                  onChange={(event) => setDraft((prev) => ({ ...prev, cost: event.target.value }))}
                  aria-invalid={draftErrors.cost ? true : undefined}
                  aria-describedby={draftErrors.cost ? 'draft-cost-error' : undefined}
                  className="cg-mono w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none aria-[invalid=true]:border-rose-500"
              />
              {draftErrors.cost && (
                  <p id="draft-cost-error" className="mt-1 text-[11px] text-rose-400">{draftErrors.cost}</p>
              )}
            </div>

            <button
                type="submit"
                className="mt-2 w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-slate-950 shadow-[0_0_22px_rgba(16,185,129,0.35)] transition-all hover:bg-emerald-400"
            >
              Raise the tombstone
            </button>
          </form>
        </Modal>

        {/* The crypt (audit vault) */}
        <Modal open={showVault} onClose={() => setShowVault(false)} labelledBy="vault-title" widthClass="max-w-5xl" accent="violet">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-2.5">
                <ShieldCheck className="h-6 w-6 text-violet-300" aria-hidden="true" />
              </div>
              <div>
                <h2 id="vault-title" className="cg-title flex items-center gap-2 text-3xl text-violet-200">
                  The crypt of records <Lock className="h-4 w-4 text-slate-500" aria-label="Read-only" />
                </h2>
                <p className="text-xs text-slate-400">Append-only grimoire of every exorcism. Read-only view.</p>
              </div>
            </div>
            <button
                type="button"
                onClick={() => setShowVault(false)}
                aria-label="Close dialog"
                className="rounded p-1 text-slate-400 transition-colors hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <dl className="cg-mono mb-5 grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px] md:grid-cols-4">
            <div>
              <dt className="text-slate-500">Bucket</dt>
              <dd className="truncate text-cyan-300">s3://{LOG_BUCKET}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Prefix</dt>
              <dd className="text-slate-300">{LOG_PREFIX}/</dd>
            </div>
            <div>
              <dt className="text-slate-500">Records</dt>
              <dd className="text-slate-300">{auditLog.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Crypt link</dt>
              <dd className={CONNECTION_STYLE[connection]}>{CONNECTION_LABEL[connection]}</dd>
            </div>
          </dl>

          {auditLog.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 py-14 text-center">
                <Ghost className="cg-float mx-auto mb-3 h-8 w-8 text-violet-300/40" aria-hidden="true" />
                <p className="cg-mono text-xs text-slate-500">The crypt is empty. Exorcise a soul to write the first record.</p>
              </div>
          ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="cg-mono w-full min-w-[940px] text-left text-[11px]">
                  <caption className="sr-only">Exorcism audit records, newest first</caption>
                  <thead className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-normal">Seq</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Timestamp (UTC)</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Event</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Soul</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Curse lifted / mo</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Mode</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Object key</th>
                    <th scope="col" className="px-3 py-2.5 font-normal">Digest</th>
                  </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-slate-300">
                  {auditLog.map((entry) => (
                      <tr key={entry.auditId} className="transition-colors hover:bg-violet-500/5">
                        <td className="px-3 py-2.5 text-slate-500">{String(entry.seq).padStart(4, '0')}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{entry.timestamp}</td>
                        <td className="px-3 py-2.5 text-rose-300">SOUL_EXORCISED</td>
                        <td className="max-w-[180px] truncate px-3 py-2.5 text-slate-200" title={entry.resourceName}>
                          {entry.resourceName}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-emerald-400">{money(entry.reclaimedMonthly)}</td>
                        <td className="px-3 py-2.5">
                      <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                              entry.mode === 'live'
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                  : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                          }`}
                      >
                        {entry.mode === 'live' ? 'LIVE' : 'SIMULATED'}
                      </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="max-w-[220px] truncate text-cyan-400" title={entry.s3Key}>{entry.s3Key}</span>
                            <button
                                type="button"
                                onClick={() => void copyKey(entry.s3Key)}
                                aria-label={`Copy object key for ${entry.resourceName}`}
                                className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                            >
                              <Copy className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500" title="FNV-1a integrity digest (non-cryptographic)">{entry.checksum}</td>
                      </tr>
                  ))}
                  </tbody>
                </table>
              </div>
          )}

          <div className="mt-6 flex flex-col-reverse justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-[11px] text-slate-600">Digests are FNV-1a integrity hints, not cryptographic signatures.</p>
            <div className="flex gap-3">
              <button
                  type="button"
                  onClick={exportVault}
                  disabled={auditLog.length === 0}
                  className="flex items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export grimoire
              </button>
              <button
                  type="button"
                  onClick={() => setShowVault(false)}
                  className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700"
              >
                Seal the crypt
              </button>
            </div>
          </div>
        </Modal>
      </div>
  );
}