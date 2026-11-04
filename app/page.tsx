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
    AlertTriangle,
    CheckCircle2,
    Clock,
    Cloud,
    Copy,
    Cpu,
    Database,
    DollarSign,
    Download,
    FileText,
    Ghost,
    HardDrive,
    Layers,
    Loader2,
    Plus,
    RefreshCw,
    Search,
    ShieldAlert,
    ShieldCheck,
    Skull,
    Trash2,
    Volume2,
    VolumeX,
    X,
    Info,
    AlertCircle,
    ChevronRight,
    MapPin,
    Tag,
    User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

type Status = 'Zombie' | 'Idle' | 'Orphaned' | 'Healthy';
type Kind = 'EC2 Instance' | 'RDS Database' | 'EBS Volume' | 'S3 Bucket';
type Region = 'us-east-1' | 'us-west-2' | 'ap-south-1' | 'eu-central-1';
type RegionFilter = Region | 'All';
type ToastTone = 'success' | 'warning' | 'info';
type Connection = 'standby' | 'live' | 'simulated';
type Dimension = 'region' | 'kind';

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
    mode: 'live' | 'simulated';
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

/* -------------------------------------------------------------------------- */
/*                                  Constants                                 */
/* -------------------------------------------------------------------------- */

const LOG_BUCKET = 'cloud-graveyard-logs';
const LOG_PREFIX = 'audit/deletions';
const SOUND_KEY = 'cg-sound-preference';

const SCAN_MS = 1500;
const EXIT_MS = 500;
const TOAST_TTL_MS = 4000;
const PURGE_TIMEOUT_MS = 4000;
const MAX_NAME_LENGTH = 64;
const MAX_COST = 100_000;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const REGIONS: readonly Region[] = ['us-east-1', 'us-west-2', 'ap-south-1', 'eu-central-1'];
const KINDS: readonly Kind[] = ['EC2 Instance', 'RDS Database', 'EBS Volume', 'S3 Bucket'];
const STATUSES: readonly Status[] = ['Zombie', 'Idle', 'Orphaned', 'Healthy'];

const SEED: Asset[] = [
    { id: 'i-0a1b2c3d', name: 'idle-ec2-dev-cluster', kind: 'EC2 Instance', status: 'Zombie', region: 'us-east-1', monthlyCost: 142.5, lastSeen: '18 days ago', owner: 'Platform', risk: 94 },
    { id: 'vol-08f3a1', name: 'unattached-ebs-volume-v1', kind: 'EBS Volume', status: 'Orphaned', region: 'ap-south-1', monthlyCost: 45, lastSeen: '42 days ago', owner: 'Unknown', risk: 88 },
    { id: 'db-test-04', name: 'abandoned-rds-testdb', kind: 'RDS Database', status: 'Zombie', region: 'us-west-2', monthlyCost: 310, lastSeen: '31 days ago', owner: 'QA', risk: 97 },
    { id: 'bucket-temp-9', name: 'legacy-s3-temp-dump', kind: 'S3 Bucket', status: 'Idle', region: 'eu-central-1', monthlyCost: 88.2, lastSeen: '64 days ago', owner: 'Data team', risk: 72 },
    { id: 'i-eks-221', name: 'stale-eks-worker-node', kind: 'EC2 Instance', status: 'Zombie', region: 'us-east-1', monthlyCost: 210, lastSeen: '12 days ago', owner: 'Platform', risk: 91 },
];

const EMPTY_DRAFT: NewAssetDraft = { name: '', kind: 'EC2 Instance', region: 'us-east-1', cost: '100' };

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
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

const STATUS_HELP: Record<Status, string> = {
    Zombie: 'Running, but unused for a long time. Safe to delete in most cases.',
    Idle: 'Low activity. Review before deleting.',
    Orphaned: 'Not attached to anything. Usually safe to delete.',
    Healthy: 'In active use. Keep this.',
};

const KIND_ICON: Record<Kind, LucideIcon> = {
    'EC2 Instance': Cpu,
    'RDS Database': Database,
    'EBS Volume': HardDrive,
    'S3 Bucket': Cloud,
};

const CONNECTION_LABEL: Record<Connection, string> = {
    standby: 'Not connected',
    live: 'Live',
    simulated: 'Simulated',
};

const CONNECTION_STYLE: Record<Connection, string> = {
    standby: 'text-slate-300',
    live: 'text-emerald-300',
    simulated: 'text-amber-300',
};

const TOAST_ICON: Record<ToastTone, LucideIcon> = {
    success: CheckCircle2,
    warning: AlertCircle,
    info: Info,
};

const TOAST_STYLE: Record<ToastTone, string> = {
    success: 'border-emerald-500/50 text-emerald-200',
    warning: 'border-rose-500/50 text-rose-200',
    info: 'border-cyan-400/50 text-cyan-200',
};

/* -------------------------------------------------------------------------- */
/*                              Sound definitions                             */
/* -------------------------------------------------------------------------- */

type Cue = 'click' | 'scan' | 'delete' | 'success' | 'warning';

interface Tone {
    type: OscillatorType;
    from: number;
    to: number;
    duration: number;
    peak: number;
    delay?: number;
}

const CUES: Record<Cue, Tone[]> = {
    click: [{ type: 'sine', from: 760, to: 560, duration: 0.08, peak: 0.06 }],
    scan: [{ type: 'sine', from: 160, to: 320, duration: 0.5, peak: 0.07 }],
    delete: [
        { type: 'sawtooth', from: 300, to: 40, duration: 0.6, peak: 0.1 },
        { type: 'sine', from: 120, to: 30, duration: 0.7, peak: 0.05 },
    ],
    success: [
        { type: 'sine', from: 523, to: 523, duration: 0.16, peak: 0.08 },
        { type: 'sine', from: 659, to: 659, duration: 0.24, peak: 0.07, delay: 0.14 },
    ],
    warning: [{ type: 'sine', from: 180, to: 130, duration: 0.3, peak: 0.1 }],
};

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };

function scheduleTone(ctx: AudioContext, tone: Tone, base: number): void {
    const start = base + (tone.delay ?? 0);
    const end = start + tone.duration;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.from, start);
    osc.frequency.exponentialRampToValueAtTime(tone.to, end);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(start);
    osc.stop(end + 0.02);
}

function useSoundEngine(enabled: boolean): (cue: Cue) => void {
    const ctxRef = useRef<AudioContext | null>(null);
    const enabledRef = useRef(enabled);

    useEffect(() => { enabledRef.current = enabled; }, [enabled]);
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
                const Ctor = window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
                if (!Ctor) return;
                ctxRef.current = new Ctor();
            }
            const ctx = ctxRef.current;
            if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
            const now = ctx.currentTime;
            CUES[cue].forEach((tone) => scheduleTone(ctx, tone, now));
        } catch {
            // Sound is decorative; never let it break the app.
        }
    }, []);
}

/* -------------------------------------------------------------------------- */
/*                               Global styles                                */
/* -------------------------------------------------------------------------- */

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Creepster&family=Share+Tech+Mono&display=swap');

.cg-root { font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.cg-mono { font-family: 'Share Tech Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.cg-title { font-family: 'Creepster', 'Impact', cursive; letter-spacing: 0.03em; text-shadow: 0 0 14px rgba(16,185,129,0.5), 0 3px 0 #052e1c; }

.cg-glass {
  background: linear-gradient(150deg, rgba(15,23,42,0.78), rgba(2,6,23,0.6));
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(51,65,85,0.5);
}
.cg-card { transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; }
.cg-card:hover { transform: translateY(-2px); border-color: rgba(16,185,129,0.35); box-shadow: 0 16px 40px -22px rgba(16,185,129,0.4); }
.cg-tombstone { border-radius: 50% 50% 6px 6px / 24% 24% 6px 6px; }

.cg-fog {
  position: fixed; inset: -20%; pointer-events: none;
  background:
    radial-gradient(ellipse 60% 35% at 30% 92%, rgba(16,185,129,0.12), transparent 70%),
    radial-gradient(ellipse 50% 30% at 78% 88%, rgba(244,63,94,0.1), transparent 70%);
  animation: cg-fog 24s ease-in-out infinite alternate;
}
.cg-moon {
  position: fixed; top: 6vh; right: 8vw; width: 130px; height: 130px; border-radius: 9999px;
  background: radial-gradient(circle at 30% 30%, rgba(241,245,249,0.85) 0%, rgba(203,213,225,0.5) 30%, rgba(100,116,139,0.2) 60%, transparent 72%);
  box-shadow: 0 0 80px 18px rgba(226,232,240,0.08), 0 0 160px 60px rgba(16,185,129,0.06);
  pointer-events: none; animation: cg-breathe 9s ease-in-out infinite;
}
.cg-vignette { position: fixed; inset: 0; pointer-events: none; background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.75) 100%); }

.cg-float { animation: cg-float 7s ease-in-out infinite; }
.cg-exit { animation: cg-exit 0.5s ease-in forwards; pointer-events: none; }
.cg-shimmer {
  background-color: rgba(30,41,59,0.5);
  background-image: linear-gradient(100deg, transparent 20%, rgba(16,185,129,0.14) 50%, transparent 80%);
  background-size: 200% 100%;
  animation: cg-shimmer 1.6s linear infinite;
}
.cg-scanline { background: linear-gradient(180deg, transparent, rgba(16,185,129,0.16), transparent); animation: cg-scan 1.5s ease-in-out infinite; }
.cg-fade-in { animation: cg-fade-in 0.2s ease-out both; }
.cg-fade-up { animation: cg-fade-up 0.28s cubic-bezier(0.22,1,0.36,1) both; }
.cg-slide-in { animation: cg-slide-in 0.28s cubic-bezier(0.22,1,0.36,1) both; }
.cg-drawer-in { animation: cg-drawer-in 0.3s cubic-bezier(0.22,1,0.36,1) both; }

@keyframes cg-fog { from { transform: translate3d(-3%,0,0); } to { transform: translate3d(3%,-2%,0); } }
@keyframes cg-breathe { 0%,100% { opacity: 0.45; } 50% { opacity: 0.7; } }
@keyframes cg-float { 0%,100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(0,-12px,0); } }
@keyframes cg-exit { to { opacity: 0; transform: scale(0.96) translateY(8px); } }
@keyframes cg-shimmer { from { background-position: 150% 0; } to { background-position: -50% 0; } }
@keyframes cg-scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(500%); } }
@keyframes cg-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cg-fade-up { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes cg-slide-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes cg-drawer-in { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .cg-root *, .cg-root *::before, .cg-root *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
`;

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

const fnv1a = (input: string): string => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const searchHaystack = (asset: Asset): string =>
    `${asset.name} ${asset.id} ${asset.region} ${asset.kind} ${asset.owner}`.toLowerCase();

const sumCost = (assets: readonly Asset[]): number => assets.reduce((t, a) => t + a.monthlyCost, 0);

function buildBreakdown(assets: readonly Asset[], by: Dimension): BreakdownRow[] {
    const total = sumCost(assets);
    const groups = new Map<string, { amount: number; count: number }>();
    for (const asset of assets) {
        const label = by === 'region' ? asset.region : asset.kind;
        const g = groups.get(label) ?? { amount: 0, count: 0 };
        g.amount += asset.monthlyCost;
        g.count += 1;
        groups.set(label, g);
    }
    return [...groups.entries()]
        .map(([label, g]) => ({ label, amount: g.amount, count: g.count, share: total > 0 ? g.amount / total : 0 }))
        .sort((a, b) => b.amount - a.amount);
}

function validateDraft(draft: NewAssetDraft): DraftErrors {
    const errors: DraftErrors = {};
    const name = draft.name.trim();
    if (!name) errors.name = 'Enter a resource name.';
    else if (name.length > MAX_NAME_LENGTH) errors.name = `Keep it under ${MAX_NAME_LENGTH} characters.`;
    else if (!NAME_PATTERN.test(name)) errors.name = 'Use letters, numbers, dots, dashes or underscores.';

    const cost = Number(draft.cost);
    if (draft.cost.trim() === '' || !Number.isFinite(cost)) errors.cost = 'Enter a numeric monthly cost.';
    else if (cost < 0 || cost > MAX_COST) errors.cost = `Must be between $0 and ${money(MAX_COST)}.`;

    return errors;
}

const isPurgeResponse = (value: unknown): value is PurgeResponse =>
    typeof value === 'object' && value !== null &&
    typeof (value as PurgeResponse).auditId === 'string' &&
    typeof (value as PurgeResponse).s3Key === 'string';

/** Calls the delete API. Any failure, timeout or bad payload throws, and the caller falls back to simulated mode. */
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
        if (!response.ok) throw new Error(`API responded with ${response.status}`);
        const payload: unknown = await response.json();
        if (!isPurgeResponse(payload)) throw new Error('Malformed response');
        return payload;
    } finally {
        clearTimeout(timeout);
    }
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
        setToasts((c) => c.filter((t) => t.id !== id));
    }, []);

    const notify = useCallback((tone: ToastTone, message: string) => {
        nextId.current += 1;
        const id = nextId.current;
        setToasts((c) => [...c.slice(-2), { id, tone, message }]);
        timers.current.set(id, setTimeout(() => dismiss(id), TOAST_TTL_MS));
    }, [dismiss]);

    useEffect(() => {
        const t = timers.current;
        return () => { t.forEach(clearTimeout); t.clear(); };
    }, []);

    return { toasts, notify, dismiss };
}

/* -------------------------------------------------------------------------- */
/*                               Decorative art                               */
/* -------------------------------------------------------------------------- */

function CobWeb({ className = '' }: { className?: string }) {
    return (
        <svg viewBox="0 0 120 120" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="0.8">
            <path d="M0 0 L120 0 M0 0 L0 120 M0 0 L120 120 M0 0 L92 120 M0 0 L120 60 M0 0 L60 120" />
            <path d="M0 22 Q22 22 22 0 M0 46 Q46 46 46 0 M0 72 Q72 72 72 0 M0 98 Q98 98 98 0" />
        </svg>
    );
}

/* -------------------------------------------------------------------------- */
/*                                 UI pieces                                  */
/* -------------------------------------------------------------------------- */

function Panel({
                   open, onClose, labelledBy, widthClass = 'max-w-md', accent = 'emerald', children, side = 'center',
               }: {
    open: boolean;
    onClose: () => void;
    labelledBy: string;
    widthClass?: string;
    accent?: 'emerald' | 'rose';
    children: React.ReactNode;
    side?: 'center' | 'right';
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        if (!open) return;
        const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panelRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
            prevFocus?.focus();
        };
    }, [open]);

    if (!open) return null;
    const ring = accent === 'rose'
        ? 'border-rose-500/40 shadow-[0_0_60px_-10px_rgba(244,63,94,0.35)]'
        : 'border-emerald-500/40 shadow-[0_0_60px_-10px_rgba(16,185,129,0.35)]';

    if (side === 'right') {
        return (
            <div className="fixed inset-0 z-50 flex justify-end">
                <div aria-hidden="true" onClick={() => onCloseRef.current()} className="cg-fade-in absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={labelledBy}
                    tabIndex={-1}
                    className={`cg-glass cg-drawer-in relative h-full w-full ${widthClass} overflow-y-auto border-l p-6 focus:outline-none ${ring}`}
                >
                    {children}
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div aria-hidden="true" onClick={() => onCloseRef.current()} className="cg-fade-in absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
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

function RiskMeter({ risk }: { risk: number }) {
    return (
        <div className="flex items-center gap-2">
            <div role="meter" aria-label="Risk score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={risk} className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${risk >= 85 ? 'bg-rose-400' : 'bg-amber-300'}`} style={{ width: `${risk}%` }} />
            </div>
            <span className="cg-mono text-xs text-slate-400">{risk}</span>
        </div>
    );
}

function StatusBadge({ status }: { status: Status }) {
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${STATUS_STYLE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
            {status}
    </span>
    );
}

function MetricCard({ label, icon: Icon, iconClass, value, valueClass, hint }: {
    label: string; icon: LucideIcon; iconClass: string; value: string; valueClass: string; hint: string;
}) {
    return (
        <div className="cg-glass cg-card rounded-2xl p-5">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                <span>{label}</span>
                <Icon className={`h-4 w-4 ${iconClass}`} aria-hidden="true" />
            </div>
            <div className={`cg-mono mt-3 text-2xl font-bold md:text-3xl ${valueClass}`}>{value}</div>
            <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
        </div>
    );
}

function SkeletonRows() {
    return (
        <>
            {[0, 1, 2, 3].map((i) => (
                <tr key={`skeleton-${i}`} aria-hidden="true">
                    <td colSpan={6} className="px-4 py-4"><div className="cg-shimmer h-12 rounded-xl" /></td>
                </tr>
            ))}
        </>
    );
}

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
    return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Ghost className="cg-float h-10 w-10 text-emerald-400/60" aria-hidden="true" />
            {hasFilters ? (
                <>
                    <p className="text-xs text-slate-400">No resources match these filters.</p>
                    <button type="button" onClick={onClear} className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10">
                        Clear filters
                    </button>
                </>
            ) : (
                <p className="text-xs text-slate-400">Every flagged resource has been removed.</p>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*                                 Main page                                  */
/* -------------------------------------------------------------------------- */

export default function CloudGraveyardDashboard() {
    const [assets, setAssets] = useState<Asset[]>(SEED);
    const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

    const [query, setQuery] = useState('');
    const deferredQuery = useDeferredValue(query);
    const [statusFilters, setStatusFilters] = useState<ReadonlySet<Status>>(() => new Set());
    const [regionFilter, setRegionFilter] = useState<RegionFilter>('All');
    const [breakdownBy, setBreakdownBy] = useState<Dimension>('region');

    const [scanning, setScanning] = useState(false);
    const [lastScan, setLastScan] = useState<Date | null>(null);
    const [purgingId, setPurgingId] = useState<string | null>(null);
    const [exitingIds, setExitingIds] = useState<ReadonlySet<string>>(() => new Set());
    const [connection, setConnection] = useState<Connection>('standby');

    const [selected, setSelected] = useState<Asset | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showAudit, setShowAudit] = useState(false);
    const [draft, setDraft] = useState<NewAssetDraft>(EMPTY_DRAFT);
    const [draftSubmitted, setDraftSubmitted] = useState(false);

    const [soundEnabled, setSoundEnabled] = useState(true);

    const searchRef = useRef<HTMLInputElement>(null);
    const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const play = useSoundEngine(soundEnabled);
    const { toasts, notify, dismiss } = useToasts();

    useEffect(() => {
        try {
            if (window.localStorage.getItem(SOUND_KEY) === 'off') setSoundEnabled(false);
        } catch { /* storage blocked */ }
    }, []);

    useEffect(() => () => {
        if (scanTimer.current) clearTimeout(scanTimer.current);
        if (exitTimer.current) clearTimeout(exitTimer.current);
    }, []);

    const anyModalOpen = showAddModal || showAudit || selected !== null;
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || anyModalOpen) return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
            e.preventDefault();
            searchRef.current?.focus();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [anyModalOpen]);

    /* ----------------------------- Derived data ----------------------------- */

    const sortedAssets = useMemo(() => [...assets].sort((a, b) => b.monthlyCost - a.monthlyCost), [assets]);

    const visibleAssets = useMemo(() => {
        const term = deferredQuery.trim().toLowerCase();
        return sortedAssets.filter((a) => {
            if (statusFilters.size > 0 && !statusFilters.has(a.status)) return false;
            if (regionFilter !== 'All' && a.region !== regionFilter) return false;
            return !term || searchHaystack(a).includes(term);
        });
    }, [sortedAssets, deferredQuery, statusFilters, regionFilter]);

    const statusCounts = useMemo(() => {
        const c: Record<Status, number> = { Zombie: 0, Idle: 0, Orphaned: 0, Healthy: 0 };
        for (const a of assets) c[a.status] += 1;
        return c;
    }, [assets]);

    const wasteAssets = useMemo(() => assets.filter((a) => a.status !== 'Healthy'), [assets]);
    const visibleWaste = useMemo(() => sumCost(visibleAssets.filter((a) => a.status !== 'Healthy')), [visibleAssets]);
    const monthlyWaste = useMemo(() => sumCost(wasteAssets), [wasteAssets]);
    const breakdownRows = useMemo(() => buildBreakdown(wasteAssets, breakdownBy), [wasteAssets, breakdownBy]);

    const zombieCount = statusCounts.Zombie;
    const highRiskCount = wasteAssets.filter((a) => a.risk >= 85).length;
    const annualDrain = monthlyWaste * 12;
    const realizedMonthly = useMemo(() => auditLog.reduce((t, e) => t + e.reclaimedMonthly, 0), [auditLog]);
    const activeFilterCount = statusFilters.size + (regionFilter !== 'All' ? 1 : 0) + (query.trim() ? 1 : 0);
    const draftErrors = useMemo<DraftErrors>(() => (draftSubmitted ? validateDraft(draft) : {}), [draft, draftSubmitted]);

    /* -------------------------------- Actions ------------------------------- */

    const toggleStatus = (status: Status) => {
        play('click');
        setStatusFilters((prev) => {
            const next = new Set(prev);
            if (next.has(status)) next.delete(status); else next.add(status);
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
        play('scan');
        setScanning(true);
        scanTimer.current = setTimeout(() => {
            scanTimer.current = null;
            setScanning(false);
            setLastScan(new Date());
            play('success');
            notify('success', `Scan complete — ${assets.length} resources re-checked.`);
        }, SCAN_MS);
    };

    const toggleSound = () => {
        const next = !soundEnabled;
        setSoundEnabled(next);
        try { window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* ignore */ }
        notify('info', next ? 'Sound effects on.' : 'Sound effects muted.');
    };

    const openDetails = (asset: Asset) => {
        play('click');
        setSelected(asset);
        setConfirmingDelete(false);
    };

    const closeDetails = useCallback(() => {
        setSelected(null);
        setConfirmingDelete(false);
    }, []);

    const executeDelete = useCallback(async (target: Asset) => {
        setPurgingId(target.id);
        play('delete');

        const timestamp = new Date().toISOString();
        let auditId: string;
        let s3Key: string;
        let mode: AuditEntry['mode'];

        try {
            const remote = await postPurge(target);
            auditId = remote.auditId;
            s3Key = remote.s3Key;
            mode = 'live';
            setConnection('live');
        } catch {
            const stamp = timestamp.replace(/[:.]/g, '-');
            auditId = `sim-${stamp}-${target.id}`;
            s3Key = `${LOG_PREFIX}/${stamp}-${target.id}.json`;
            mode = 'simulated';
            setConnection('simulated');
            notify('warning', 'Delete API unreachable — recorded in simulated mode.');
        }

        const record = {
            auditId, resourceId: target.id, resourceName: target.name,
            reclaimedMonthly: target.monthlyCost, timestamp, s3Key, mode,
        };
        setAuditLog((prev) => [{ ...record, seq: prev.length + 1, checksum: fnv1a(JSON.stringify(record)) }, ...prev]);

        setExitingIds((prev) => new Set(prev).add(target.id));
        closeDetails();
        play('success');
        notify('success', `Deleted ${target.name}. ${money(target.monthlyCost)}/mo reclaimed.`);

        exitTimer.current = setTimeout(() => {
            exitTimer.current = null;
            setAssets((current) => current.filter((a) => a.id !== target.id));
            setExitingIds((prev) => { const n = new Set(prev); n.delete(target.id); return n; });
            setPurgingId(null);
        }, EXIT_MS);
    }, [play, notify, closeDetails]);

    const closeAddModal = useCallback(() => { setShowAddModal(false); setDraftSubmitted(false); }, []);
    const openAddModal = () => { play('click'); setShowAddModal(true); };
    const openAudit = () => { play('click'); setShowAudit(true); };

    const submitDraft = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setDraftSubmitted(true);
        if (Object.keys(validateDraft(draft)).length > 0) {
            play('warning');
            notify('warning', 'Fix the highlighted fields.');
            return;
        }
        const created: Asset = {
            id: `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            name: draft.name.trim(), kind: draft.kind, region: draft.region,
            status: 'Zombie', monthlyCost: Number(draft.cost), lastSeen: 'Just now', owner: 'SecOps', risk: 95,
        };
        setAssets((c) => [created, ...c]);
        setDraft(EMPTY_DRAFT);
        setDraftSubmitted(false);
        setShowAddModal(false);
        play('success');
        notify('info', `Added ${created.name} to monitoring.`);
    };

    const exportAudit = () => {
        play('click');
        const payload = { bucket: LOG_BUCKET, prefix: LOG_PREFIX, exportedAt: new Date().toISOString(), records: auditLog };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cloud-graveyard-audit-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        notify('success', `Exported ${auditLog.length} record${auditLog.length === 1 ? '' : 's'}.`);
    };

    const copyKey = async (key: string) => {
        play('click');
        try {
            await navigator.clipboard.writeText(key);
            notify('success', 'Object key copied.');
        } catch {
            notify('warning', 'Clipboard unavailable in this browser context.');
        }
    };

    /* --------------------------------- Render ------------------------------- */

    return (
        <div className="cg-root relative min-h-screen overflow-x-hidden bg-[#04060a] p-5 text-slate-100 md:p-10">
            <style>{GLOBAL_CSS}</style>

            <div aria-hidden="true" className="cg-fog" />
            <div aria-hidden="true" className="cg-moon" />
            <div aria-hidden="true" className="cg-vignette" />
            <CobWeb className="pointer-events-none fixed left-0 top-0 h-48 w-48 text-slate-300 opacity-10" />
            <CobWeb className="pointer-events-none fixed bottom-0 right-0 h-56 w-56 rotate-180 text-slate-300 opacity-10" />

            {/* Toasts */}
            <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
                {toasts.map((toast) => {
                    const Icon = TOAST_ICON[toast.tone];
                    return (
                        <div key={toast.id} className={`cg-slide-in pointer-events-auto flex items-center gap-3 rounded-2xl border bg-slate-950/90 px-4 py-3 shadow-2xl backdrop-blur ${TOAST_STYLE[toast.tone]}`}>
                            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className="flex-1 text-xs font-semibold">{toast.message}</span>
                            <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification" className="rounded p-0.5 text-slate-400 transition-colors hover:text-white">
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
              System active
            </span>
                        <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Last scan: <strong className="cg-mono font-normal text-slate-300">{lastScan ? lastScan.toLocaleTimeString('en-US', { hour12: false }) : 'never'}</strong>
            </span>
                        <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              Delete API: <strong className={`font-semibold ${CONNECTION_STYLE[connection]}`}>{CONNECTION_LABEL[connection]}</strong>
            </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={toggleSound} aria-pressed={soundEnabled} className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 transition-colors hover:border-emerald-500/40 hover:text-emerald-300">
                            {soundEnabled ? <Volume2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> : <VolumeX className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />}
                            Sound {soundEnabled ? 'on' : 'off'}
                        </button>
                        <button type="button" onClick={openAudit} className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 transition-colors hover:border-emerald-500/40 hover:text-emerald-300">
                            <FileText className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                            Audit log ({auditLog.length})
                        </button>
                    </div>
                </div>

                {/* Header */}
                <header className="flex flex-col justify-between gap-6 border-b border-slate-800/80 pb-8 md:flex-row md:items-center">
                    <div className="flex min-w-0 items-center gap-5">
                        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/40 p-3.5 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                            <Skull className="h-9 w-9 text-emerald-400" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <h1 className="cg-title text-4xl leading-none text-emerald-300 md:text-5xl">CLOUD GRAVEYARD</h1>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                  Hack-to-ween 2026
                </span>
                                <span className="text-xs text-slate-400">Find unused cloud resources, see what they cost, and delete them safely.</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={runScan} disabled={scanning} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-bold text-slate-950 shadow-[0_0_24px_rgba(16,185,129,0.35)] transition-all hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-60">
                            {scanning ? <RefreshCw className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                            {scanning ? 'Scanning…' : 'Scan resources'}
                        </button>
                        <button type="button" onClick={openAddModal} className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-slate-900/80 px-4 py-3 text-xs font-bold text-emerald-300 shadow-lg transition-all hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
                            <Plus className="h-4 w-4" aria-hidden="true" /> Add resource
                        </button>
                    </div>
                </header>

                {/* Cost anomaly banner */}
                <section aria-labelledby="anomaly-title" className="cg-glass my-6 flex flex-col gap-4 rounded-2xl border-rose-500/30 bg-gradient-to-r from-rose-950/50 via-slate-900/80 to-slate-900/80 p-5 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-4">
                        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5">
                            <ShieldAlert className="h-5 w-5 text-rose-400" aria-hidden="true" />
                        </div>
                        <div>
                            <h2 id="anomaly-title" className="text-xs font-bold uppercase tracking-wider text-rose-300">Cost alert</h2>
                            <p className="mt-1 text-xs text-slate-400">
                                {zombieCount} unused and {highRiskCount} high-risk resource{highRiskCount === 1 ? '' : 's'} are costing{' '}
                                <span className="font-semibold text-rose-300">{money(monthlyWaste)}</span> per month.
                            </p>
                        </div>
                    </div>
                    <dl className="flex gap-8 md:text-right">
                        <div>
                            <dt className="text-[10px] uppercase tracking-wider text-slate-500">Projected yearly cost</dt>
                            <dd className="cg-mono text-base font-bold text-rose-400">{money(annualDrain)} / yr</dd>
                        </div>
                        <div>
                            <dt className="text-[10px] uppercase tracking-wider text-slate-500">Saved this session</dt>
                            <dd className="cg-mono text-base font-bold text-emerald-400">{money(realizedMonthly * 12)} / yr</dd>
                        </div>
                    </dl>
                </section>

                {/* Metrics */}
                <div className="my-6 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label="Monitored resources" icon={Layers} iconClass="text-emerald-400" value={String(assets.length)} valueClass="text-white" hint="Across all regions" />
                    <MetricCard label="Flagged as unused" icon={AlertTriangle} iconClass="text-rose-400" value={String(zombieCount)} valueClass="text-rose-400" hint="Recommended for deletion" />
                    <MetricCard label="Monthly waste" icon={DollarSign} iconClass="text-cyan-400" value={money(monthlyWaste)} valueClass="text-cyan-400" hint="Recoverable if deleted" />
                    <MetricCard label="Saved this session" icon={ShieldCheck} iconClass="text-emerald-400" value={money(realizedMonthly)} valueClass="text-emerald-400" hint={`${auditLog.length} deletion${auditLog.length === 1 ? '' : 's'} logged`} />
                </div>

                {/* Breakdown */}
                <section aria-labelledby="breakdown-title" className="cg-glass cg-card mb-6 rounded-2xl p-5">
                    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h2 id="breakdown-title" className="text-xs font-bold uppercase tracking-wider text-slate-300">Waste by {breakdownBy === 'region' ? 'region' : 'service type'}</h2>
                            <p className="mt-1 text-[11px] text-slate-500">Where the monthly cost is coming from</p>
                        </div>
                        <div role="group" aria-label="Group by" className="inline-flex self-start rounded-lg border border-slate-800 bg-slate-950/70 p-0.5">
                            {(['region', 'kind'] as const).map((option) => (
                                <button key={option} type="button" aria-pressed={breakdownBy === option} onClick={() => setBreakdownBy(option)}
                                        className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors ${breakdownBy === option ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-slate-200'}`}>
                                    {option === 'region' ? 'By region' : 'By service'}
                                </button>
                            ))}
                        </div>
                    </div>
                    {breakdownRows.length === 0 ? (
                        <p className="py-4 text-center text-xs text-slate-500">No waste to break down.</p>
                    ) : (
                        <ul className="space-y-3">
                            {breakdownRows.map((row, i) => (
                                <li key={row.label} className="cg-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                                        <span className="cg-mono text-slate-200">{row.label} <span className="ml-2 text-[10px] text-slate-500">{row.count} resource{row.count === 1 ? '' : 's'}</span></span>
                                        <span className="cg-mono text-slate-400"><span className="text-cyan-300">{money(row.amount)}</span> · {(row.share * 100).toFixed(1)}%</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-slate-800/80" aria-hidden="true">
                                        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-300 to-cyan-400 transition-[width] duration-700 ease-out" style={{ width: `${Math.max(row.share * 100, 2)}%` }} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {/* Resource list */}
                <section aria-labelledby="desk-title" className="cg-glass relative overflow-hidden rounded-2xl p-4 md:p-6">
                    <div className="mb-6 flex flex-col gap-4 border-b border-slate-800/60 pb-6">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <h2 id="desk-title" className="cg-title text-2xl text-slate-100">Resources</h2>
                                <p className="text-[11px] text-slate-500">Click a resource to see details and delete it.</p>
                            </div>
                            <div className="relative w-full md:max-w-sm">
                                <label htmlFor="resource-search" className="sr-only">Search resources</label>
                                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                                <input id="resource-search" ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                                       placeholder="Search name, ID, owner…"
                                       className="w-full rounded-xl border border-slate-800 bg-slate-950/80 py-2.5 pl-10 pr-10 text-xs text-slate-200 placeholder-slate-500 transition-colors focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
                                <kbd className="cg-mono pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 md:block">/</kbd>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
                                {STATUSES.map((status) => {
                                    const active = statusFilters.has(status);
                                    return (
                                        <button key={status} type="button" aria-pressed={active} onClick={() => toggleStatus(status)}
                                                className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${active ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-slate-800/60 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'}`}>
                                            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
                                            {status}
                                            <span className="cg-mono text-[10px] opacity-70">{statusCounts[status]}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <select id="region-filter" aria-label="Filter by region" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value as RegionFilter)}
                                    className="cg-mono rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-300 focus:border-emerald-500/50 focus:outline-none">
                                <option value="All">All regions</option>
                                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>

                        <div className="flex flex-col gap-2 text-xs md:flex-row md:items-center md:justify-between">
                            <p role="status" aria-live="polite" className="cg-mono text-slate-400">
                                Showing <strong className="font-normal text-slate-200">{visibleAssets.length}</strong> of {assets.length}
                                {' · '}<span className="text-cyan-400">{money(visibleWaste)}/mo</span> at risk
                                {activeFilterCount > 0 && <span className="text-slate-500"> · {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} active</span>}
                            </p>
                            {activeFilterCount > 0 && (
                                <button type="button" onClick={clearFilters} className="self-start font-semibold text-emerald-400 underline-offset-4 hover:underline md:self-auto">Clear filters</button>
                            )}
                        </div>
                    </div>

                    {/* Desktop table */}
                    <div className="relative hidden overflow-hidden md:block">
                        {scanning && <div aria-hidden="true" className="cg-scanline pointer-events-none absolute inset-x-0 top-0 z-10 h-24" />}
                        <table className="w-full min-w-[860px] border-collapse text-left">
                            <caption className="sr-only">Cloud resources</caption>
                            <thead>
                            <tr className="border-b border-slate-800/80 text-[11px] uppercase tracking-wider text-slate-500">
                                <th scope="col" className="px-4 py-3.5 font-semibold">Resource</th>
                                <th scope="col" className="px-4 py-3.5 font-semibold">Service / region</th>
                                <th scope="col" className="px-4 py-3.5 font-semibold">Status</th>
                                <th scope="col" className="px-4 py-3.5 font-semibold">Risk</th>
                                <th scope="col" className="px-4 py-3.5 font-semibold">Monthly cost</th>
                                <th scope="col" className="px-4 py-3.5 text-right font-semibold" />
                            </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/40">
                            {scanning && <SkeletonRows />}
                            {!scanning && visibleAssets.map((asset) => {
                                const Icon = KIND_ICON[asset.kind];
                                const exiting = exitingIds.has(asset.id);
                                return (
                                    <tr key={asset.id}
                                        onClick={() => openDetails(asset)}
                                        className={`group/row cursor-pointer transition-colors hover:bg-emerald-500/5 ${exiting ? 'cg-exit' : ''}`}>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="cg-tombstone flex h-11 w-9 shrink-0 items-center justify-center border border-slate-700 bg-slate-950 text-emerald-400 transition-transform duration-300 group-hover/row:scale-105">
                                                    <Icon className="h-4 w-4" aria-hidden="true" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="cg-mono truncate text-xs text-slate-100">{asset.name}</div>
                                                    <div className="cg-mono text-[10px] text-slate-500">{asset.id} · {asset.owner}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <p className="text-xs font-semibold text-slate-300">{asset.kind}</p>
                                            <p className="cg-mono text-[10px] text-slate-500">{asset.region}</p>
                                        </td>
                                        <td className="px-4 py-4"><StatusBadge status={asset.status} /></td>
                                        <td className="px-4 py-4"><RiskMeter risk={asset.risk} /></td>
                                        <td className="cg-mono px-4 py-4 text-sm font-bold text-emerald-400">{money(asset.monthlyCost)}</td>
                                        <td className="px-4 py-4 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 transition-colors group-hover/row:text-emerald-300">
                          Details <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {!scanning && visibleAssets.length === 0 && (
                                <tr><td colSpan={6}><EmptyState hasFilters={activeFilterCount > 0} onClear={clearFilters} /></td></tr>
                            )}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <ul className="space-y-3 md:hidden">
                        {scanning && [0, 1, 2].map((i) => <li key={`sk-${i}`} aria-hidden="true" className="cg-shimmer h-28 rounded-2xl" />)}
                        {!scanning && visibleAssets.map((asset) => {
                            const Icon = KIND_ICON[asset.kind];
                            const exiting = exitingIds.has(asset.id);
                            return (
                                <li key={asset.id} onClick={() => openDetails(asset)}
                                    className={`cg-card cursor-pointer rounded-2xl border border-slate-800 bg-slate-950/60 p-4 ${exiting ? 'cg-exit' : ''}`}>
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
                                    <div className="flex items-center justify-between">
                                        <RiskMeter risk={asset.risk} />
                                        <span className="cg-mono text-sm font-bold text-emerald-400">{money(asset.monthlyCost)}</span>
                                    </div>
                                </li>
                            );
                        })}
                        {!scanning && visibleAssets.length === 0 && <li><EmptyState hasFilters={activeFilterCount > 0} onClear={clearFilters} /></li>}
                    </ul>
                </section>

                <footer className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-slate-800/60 pt-6 text-[11px] text-slate-600 md:flex-row">
                    <span>CloudGraveyard · Hack-to-ween 2026 · IIT Jodhpur</span>
                    <span className="cg-mono">Audit records persist for this session unless the delete API is live.</span>
                </footer>
            </div>

            {/* Resource detail drawer */}
            <Panel open={selected !== null} onClose={closeDetails} labelledBy="detail-title" side="right" widthClass="max-w-md" accent={confirmingDelete ? 'rose' : 'emerald'}>
                {selected && (() => {
                    const Icon = KIND_ICON[selected.kind];
                    const busy = purgingId === selected.id;
                    return (
                        <>
                            <div className="mb-6 flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="cg-tombstone flex h-14 w-11 shrink-0 items-center justify-center border border-slate-700 bg-slate-950 text-emerald-400">
                                        <Icon className="h-5 w-5" aria-hidden="true" />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 id="detail-title" className="cg-mono truncate text-sm font-bold text-slate-100">{selected.name}</h2>
                                        <p className="cg-mono text-[11px] text-slate-500">{selected.id}</p>
                                    </div>
                                </div>
                                <button type="button" onClick={closeDetails} aria-label="Close details" className="rounded p-1 text-slate-400 transition-colors hover:text-white">
                                    <X className="h-5 w-5" aria-hidden="true" />
                                </button>
                            </div>

                            <div className="mb-5"><StatusBadge status={selected.status} /></div>
                            <p className="mb-6 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                                {STATUS_HELP[selected.status]}
                            </p>

                            <dl className="mb-6 space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                                    <dt className="flex items-center gap-2 text-xs text-slate-500"><Tag className="h-3.5 w-3.5" aria-hidden="true" /> Type</dt>
                                    <dd className="text-xs font-semibold text-slate-200">{selected.kind}</dd>
                                </div>
                                <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                                    <dt className="flex items-center gap-2 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Region</dt>
                                    <dd className="cg-mono text-xs font-semibold text-slate-200">{selected.region}</dd>
                                </div>
                                <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                                    <dt className="flex items-center gap-2 text-xs text-slate-500"><User className="h-3.5 w-3.5" aria-hidden="true" /> Owner</dt>
                                    <dd className="text-xs font-semibold text-slate-200">{selected.owner}</dd>
                                </div>
                                <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                                    <dt className="flex items-center gap-2 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> Last activity</dt>
                                    <dd className="text-xs font-semibold text-slate-200">{selected.lastSeen}</dd>
                                </div>
                                <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                                    <dt className="text-xs text-slate-500">Risk score</dt>
                                    <dd><RiskMeter risk={selected.risk} /></dd>
                                </div>
                                <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                                    <dt className="text-xs font-semibold text-slate-300">Monthly cost</dt>
                                    <dd className="cg-mono text-lg font-bold text-emerald-400">{money(selected.monthlyCost)}</dd>
                                </div>
                            </dl>

                            {!confirmingDelete ? (
                                <button type="button" onClick={() => { play('click'); setConfirmingDelete(true); }} disabled={busy}
                                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-xs font-bold text-rose-200 transition-all hover:border-rose-500 hover:bg-rose-600 hover:text-white disabled:opacity-50">
                                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete this resource
                                </button>
                            ) : (
                                <div className="cg-fade-up space-y-3 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4">
                                    <p className="text-xs text-rose-200">
                                        This will permanently delete <strong>{selected.name}</strong> and write an audit record. This can&apos;t be undone.
                                    </p>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => setConfirmingDelete(false)} disabled={busy}
                                                className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50">
                                            Cancel
                                        </button>
                                        <button type="button" onClick={() => void executeDelete(selected)} disabled={busy}
                                                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-rose-500 bg-rose-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-500 disabled:opacity-60">
                                            {busy ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                                            {busy ? 'Deleting…' : 'Confirm delete'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    );
                })()}
            </Panel>

            {/* Add resource */}
            <Panel open={showAddModal} onClose={closeAddModal} labelledBy="register-title">
                <div className="mb-5 flex items-center justify-between">
                    <h2 id="register-title" className="flex items-center gap-2 text-lg font-bold text-slate-100">
                        <Plus className="h-5 w-5 text-emerald-400" aria-hidden="true" /> Add resource
                    </h2>
                    <button type="button" onClick={closeAddModal} aria-label="Close dialog" className="rounded p-1 text-slate-400 transition-colors hover:text-white">
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>
                <p className="-mt-3 mb-5 text-xs text-slate-400">Manually register a resource so it shows up in the inventory.</p>

                <form onSubmit={submitDraft} noValidate className="space-y-4">
                    <div>
                        <label htmlFor="draft-name" className="mb-1 block text-xs text-slate-400">Resource name</label>
                        <input id="draft-name" type="text" value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                               placeholder="e.g. orphan-s3-backup-v2" maxLength={MAX_NAME_LENGTH + 20}
                               aria-invalid={draftErrors.name ? true : undefined} aria-describedby={draftErrors.name ? 'draft-name-error' : undefined}
                               className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none aria-[invalid=true]:border-rose-500" />
                        {draftErrors.name && <p id="draft-name-error" className="mt-1 text-[11px] text-rose-400">{draftErrors.name}</p>}
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label htmlFor="draft-kind" className="mb-1 block text-xs text-slate-400">Service type</label>
                            <select id="draft-kind" value={draft.kind} onChange={(e) => setDraft((p) => ({ ...p, kind: e.target.value as Kind }))}
                                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none">
                                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="draft-region" className="mb-1 block text-xs text-slate-400">Region</label>
                            <select id="draft-region" value={draft.region} onChange={(e) => setDraft((p) => ({ ...p, region: e.target.value as Region }))}
                                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none">
                                {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="draft-cost" className="mb-1 block text-xs text-slate-400">Monthly cost (USD)</label>
                        <input id="draft-cost" type="number" inputMode="decimal" min={0} max={MAX_COST} step={0.01} value={draft.cost}
                               onChange={(e) => setDraft((p) => ({ ...p, cost: e.target.value }))}
                               aria-invalid={draftErrors.cost ? true : undefined} aria-describedby={draftErrors.cost ? 'draft-cost-error' : undefined}
                               className="cg-mono w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none aria-[invalid=true]:border-rose-500" />
                        {draftErrors.cost && <p id="draft-cost-error" className="mt-1 text-[11px] text-rose-400">{draftErrors.cost}</p>}
                    </div>
                    <button type="submit" className="mt-2 w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-slate-950 shadow-lg transition-all hover:bg-emerald-400">
                        Add to monitoring
                    </button>
                </form>
            </Panel>

            {/* Audit log */}
            <Panel open={showAudit} onClose={() => setShowAudit(false)} labelledBy="audit-title" widthClass="max-w-5xl">
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                            <ShieldCheck className="h-6 w-6 text-emerald-400" aria-hidden="true" />
                        </div>
                        <div>
                            <h2 id="audit-title" className="text-base font-bold text-slate-100">Audit log</h2>
                            <p className="text-xs text-slate-400">Every deletion made in this session, in order.</p>
                        </div>
                    </div>
                    <button type="button" onClick={() => setShowAudit(false)} aria-label="Close dialog" className="rounded p-1 text-slate-400 transition-colors hover:text-white">
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </div>

                <dl className="cg-mono mb-5 grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px] md:grid-cols-4">
                    <div><dt className="text-slate-500">Bucket</dt><dd className="truncate text-cyan-300">s3://{LOG_BUCKET}</dd></div>
                    <div><dt className="text-slate-500">Prefix</dt><dd className="text-slate-300">{LOG_PREFIX}/</dd></div>
                    <div><dt className="text-slate-500">Records</dt><dd className="text-slate-300">{auditLog.length}</dd></div>
                    <div><dt className="text-slate-500">Status</dt><dd className={CONNECTION_STYLE[connection]}>{CONNECTION_LABEL[connection]}</dd></div>
                </dl>

                {auditLog.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 py-14 text-center">
                        <Ghost className="cg-float mx-auto mb-3 h-8 w-8 text-emerald-300/40" aria-hidden="true" />
                        <p className="cg-mono text-xs text-slate-500">Nothing deleted yet. Delete a resource to create the first record.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-800">
                        <table className="cg-mono w-full min-w-[900px] text-left text-[11px]">
                            <caption className="sr-only">Deletion audit records, newest first</caption>
                            <thead className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500">
                            <tr>
                                <th scope="col" className="px-3 py-2.5 font-normal">Seq</th>
                                <th scope="col" className="px-3 py-2.5 font-normal">Timestamp (UTC)</th>
                                <th scope="col" className="px-3 py-2.5 font-normal">Resource</th>
                                <th scope="col" className="px-3 py-2.5 font-normal">Reclaimed / mo</th>
                                <th scope="col" className="px-3 py-2.5 font-normal">Mode</th>
                                <th scope="col" className="px-3 py-2.5 font-normal">Object key</th>
                                <th scope="col" className="px-3 py-2.5 font-normal">Checksum</th>
                            </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/70 text-slate-300">
                            {auditLog.map((entry) => (
                                <tr key={entry.auditId} className="transition-colors hover:bg-slate-800/30">
                                    <td className="px-3 py-2.5 text-slate-500">{String(entry.seq).padStart(4, '0')}</td>
                                    <td className="whitespace-nowrap px-3 py-2.5">{entry.timestamp}</td>
                                    <td className="max-w-[180px] truncate px-3 py-2.5 text-slate-200" title={entry.resourceName}>{entry.resourceName}</td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-emerald-400">{money(entry.reclaimedMonthly)}</td>
                                    <td className="px-3 py-2.5">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${entry.mode === 'live' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-400/30 bg-amber-400/10 text-amber-300'}`}>
                        {entry.mode === 'live' ? 'LIVE' : 'SIMULATED'}
                      </span>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <div className="flex items-center gap-2">
                                            <span className="max-w-[220px] truncate text-cyan-400" title={entry.s3Key}>{entry.s3Key}</span>
                                            <button type="button" onClick={() => void copyKey(entry.s3Key)} aria-label={`Copy object key for ${entry.resourceName}`}
                                                    className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-emerald-300">
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
                    <p className="text-[11px] text-slate-600">Checksums are FNV-1a integrity hints, not cryptographic signatures.</p>
                    <div className="flex gap-3">
                        <button type="button" onClick={exportAudit} disabled={auditLog.length === 0}
                                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40">
                            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export JSON
                        </button>
                        <button type="button" onClick={() => setShowAudit(false)} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700">
                            Close
                        </button>
                    </div>
                </div>
            </Panel>
        </div>
    );
}