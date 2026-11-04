<div align="center">

# 🎃 CloudGraveyard — Find and Delete Wasted Cloud Resources

**A FinOps tool that scans your cloud inventory, flags unused resources, shows what they're costing you, and deletes them with an auditable trail — wrapped in an animated Halloween interface.**

Built for **Hack-to-ween 2026** · IIT Jodhpur

[Live Demo](#) · [Report Bug](https://github.com/RudrakshTare12/cloud-graveyard/issues) · [Request Feature](https://github.com/RudrakshTare12/cloud-graveyard/issues)

</div>

---

## 🚀 Overview

Cloud bills quietly grow because nobody remembers to turn things off: a dev EC2 instance nobody uses, an EBS volume with nothing attached, a test database from last quarter. **CloudGraveyard** finds those resources, tells you exactly what they cost per month and per year, and lets you delete them safely — with every deletion written to an audit log so you have a record of what was removed and when.

The product is simple to use by design: one click on a resource opens a detail panel, and deleting requires one explicit confirmation. The Halloween theme lives in the visuals and feedback, not in the labels — every button says exactly what it does.

## ✨ Key Features

### Core product
- **🔍 One-click resource scan** — re-checks inventory with a loading state and a timestamp of the last scan.
- **🪦 Click-through detail drawer** — click any resource to open a side panel with its type, region, owner, last activity, risk score, and monthly cost before deciding to delete it.
- **💀 Safe two-step deletion** — delete requires explicit confirmation inside the drawer, and writes a permanent, exportable audit record.
- **📊 Live cost alert banner** — current monthly waste and projected annual cost, updated as resources are added or removed.
- **📈 Waste breakdown** — toggle between "by region" and "by service type."
- **📜 Audit log** — every deletion is logged with a timestamp, reclaimed cost, S3 object key, and an integrity checksum; exportable as JSON.
- **🔌 Live/Simulated mode** — calls `POST /api/purge`; if there's no backend connected, it automatically falls back to simulated mode and says so (never fakes a live result).

### Halloween experience
- **🦇 Entrance sequence** — on first visit, a bat flies across the screen and a walking skeleton (legs and arms animate step-by-step) crosses the page while the title fades in. Plays once per browser, skipped automatically if the OS has reduced motion enabled.
- **🌫️ Animated background** — drifting fog, a glowing moon, looping bats, and translucent rising pumpkins, all behind the content and never blocking clicks.
- **💀 Skeleton reactions** — a small skeleton face appears after key actions: **smiling** when you add a resource, finish a scan, or export the audit log; **neutral** when you delete a resource. Auto-dismisses in ~2 seconds.
- **🔊 Sound design** — distinct Web Audio cues for scanning, adding, deleting, warnings, and a one-click mute toggle that remembers your preference.
- **🎨 Dark glass UI** — glassmorphism cards, tombstone-shaped icons, skeleton loading rows during scans, full keyboard and screen-reader support (focus traps, `Escape` to close, ARIA roles, `/` to focus search).
- **📱 Fully responsive** — table view on desktop, card view on mobile.

## 🛠️ Tech Stack

- **Frontend:** Next.js 14 (App Router), React, TypeScript
- **Styling:** Tailwind CSS, custom CSS keyframe animations
- **Icons:** Lucide React
- **Audio:** Web Audio API (no external audio files)
- **Backend (expected):** Node.js API route at `/api/purge`
- **Cloud Integration:** AWS SDK for JavaScript v3 (S3 for audit log persistence)

## 📦 Getting Started

### Prerequisites
- Node.js 18+
- npm or pnpm

### Local Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/RudrakshTare12/cloud-graveyard.git
   cd cloud-graveyard
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the development server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **(Optional) Connect a real delete API**
   The app calls `POST /api/purge` with `{ resourceId, resourceName, kind, region, monthlyCost }` and expects `{ auditId, s3Key }` back. Without this route, every deletion is automatically logged in **Simulated** mode instead — the app still works end-to-end for demo purposes.

   Example route using AWS SDK v3:
   ```ts
   // app/api/purge/route.ts
   import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
   import { randomUUID } from 'crypto';

   const s3 = new S3Client({ region: process.env.AWS_REGION });

   export async function POST(req: Request) {
     const body = await req.json();
     const auditId = randomUUID();
     const s3Key = `audit/deletions/${Date.now()}-${body.resourceId}.json`;

     await s3.send(new PutObjectCommand({
       Bucket: process.env.AUDIT_BUCKET,
       Key: s3Key,
       Body: JSON.stringify({ ...body, auditId, timestamp: new Date().toISOString() }),
       ContentType: 'application/json',
     }));

     return Response.json({ auditId, s3Key });
   }
   ```

## 🗂️ Project Structure
cloud-graveyard/
├── app/
│ ├── page.tsx # Main dashboard (UI, animations, logic)
│ └── api/
│ └── purge/
│ └── route.ts # Delete + audit-log API (add this for live mode)
├── public/
├── package.json
└── README.md

## 🎯 How It Maps to the Hackathon Rubric

| Criterion | What this build covers |
|---|---|
| **Event Theme** | Entrance animation (bat + walking skeleton), animated fog/moon/pumpkin background, skeleton reaction feedback, themed sound design |
| **AWS Implementation / Deployment** | `/api/purge` contract designed for S3-backed audit logging via AWS SDK v3 |
| **Idea & Problem Statement** | Directly addresses idle cloud spend — a real, common FinOps problem |
| **UI / UX** | Click-through detail drawer, plain-language labels, clear success/delete feedback, responsive layouts, accessible modals |
| **Business Model / Scale** | Cost alert tracking, waste breakdown by region/service, projected annual savings |
| **Codebase & README** | Fully typed TypeScript, no unused dependencies, documented setup and API contract |

## 🧭 Roadmap

- [ ] Wire up `/api/purge` to real AWS SDK calls with S3 Object Lock for tamper-evident storage
- [ ] Add authentication and per-team resource ownership
- [ ] Replace the in-memory seed data with a live multi-cloud resource scanner
- [ ] Add scheduled scans + email/Slack alerts for newly flagged resources

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">
Built with 🎃 for Hack-to-ween 2026 · IIT Jodhpur
</div>