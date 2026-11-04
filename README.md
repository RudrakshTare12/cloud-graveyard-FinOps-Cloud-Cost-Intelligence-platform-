<div align="center">

# 🎃 CloudGraveyard — Find and Delete Wasted Cloud Resources

**A FinOps tool that scans your cloud inventory, flags unused resources, shows what they're costing you, and deletes them with an auditable trail — wrapped in a Halloween-themed interface.**

Built for **Hack-to-ween 2026** · IIT Jodhpur

[Live Demo](#) · [Report Bug](https://github.com/RudrakshTare12/cloud-graveyard/issues) · [Request Feature](https://github.com/RudrakshTare12/cloud-graveyard/issues)

</div>

---

## 🚀 Overview

Cloud bills quietly grow because nobody remembers to turn things off: a dev EC2 instance nobody uses, an EBS volume with nothing attached, a test database from last quarter. **CloudGraveyard** finds those resources, tells you exactly what they cost per month and per year, and lets you delete them safely — with every deletion written to an audit log so you have a record of what was removed and when.

The interface leans into a Halloween theme (dark cyberpunk graveyard, glowing fog, tombstone-style resource cards, Web Audio sound effects) without hiding the actual product behind costume jargon — every button does what it says.

## ✨ Key Features

- **🔍 One-click resource scan** — simulates a re-check of your inventory with a loading state and timestamp of the last scan.
- **🪦 Click-through detail drawer** — click any resource to open a side panel with full details (type, region, owner, last activity, risk score, monthly cost) before deciding to delete it.
- **💀 Safe two-step deletion** — delete requires an explicit confirmation step inside the detail drawer, and writes a permanent audit record.
- **📊 Cost Anomaly banner** — live monthly and projected annual waste, updated as resources are added or removed.
- **📈 Waste breakdown** — toggle between "by region" and "by service type" to see where the cost is concentrated.
- **📜 Audit log** — every deletion is logged with a timestamp, reclaimed cost, object key, and an integrity checksum; exportable as JSON.
- **🔌 Live/Simulated mode** — attempts a real `POST /api/purge` call; if the backend isn't connected, it falls back to simulated mode automatically and tells you so (never silently fakes a live result).
- **🔊 Sound design** — short Web Audio cues for scanning, deleting, and confirmations, with a one-click mute toggle that persists across visits.
- **🎨 Immersive dark UI** — glassmorphism cards, ambient fog and moonlight, tombstone-shaped icons, skeleton loaders during scans, and full keyboard/accessibility support (focus traps, `Escape` to close, ARIA roles, `/` to focus search).
- **📱 Fully responsive** — table view on desktop, card view on mobile.

## 🛠️ Tech Stack

- **Frontend:** Next.js 14 (App Router), React, TypeScript
- **Styling:** Tailwind CSS, custom CSS animations
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

## 🎯 How It Maps to the Hackathon Rubric

| Criterion | What this build covers |
|---|---|
| **Event Theme** | Halloween-styled graveyard UI, tombstone resource cards, themed sound design |
| **AWS Implementation / Deployment** | `/api/purge` contract designed for S3-backed audit logging via AWS SDK v3 |
| **Idea & Problem Statement** | Directly addresses idle cloud spend — a real, common FinOps problem |
| **UI / UX** | Click-through detail drawer, clear plain-language labels, responsive table/card views, accessible modals |
| **Business Model / Scale** | Cost anomaly tracking, waste breakdown by region/service, projected annual savings |
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