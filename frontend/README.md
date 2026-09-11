# BlurGuard Frontend

A frontend-only prototype for the BlurGuard real-time screen privacy product.

## Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- Lucide React icons
- Component-oriented architecture ready for a future Tauri desktop shell

## What is included

- Overview dashboard
- Live Monitor preview
- Detections table + search
- Privacy Policies
- Application-specific protection
- Settings
- Responsive desktop/tablet/mobile UI
- Mock data only — no OCR, CV, native screen capture or backend logic yet

## Run

```bash
npm install
npm run dev
```

Then open the URL printed by Vite (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

## Where to connect the future logic

The current UI is intentionally decoupled from the detection engine. Later you can add:

- Tauri commands for screen capture and native OS APIs
- WebSocket or IPC events for real-time detections
- FastAPI endpoints for configuration/analytics if needed
- OCR/Presidio/vision services
- Real detection objects replacing the mock arrays in `App.tsx`

## Suggested next architecture

src/
  components/
    ui/
    dashboard/
    monitor/
    detections/
    policies/
  pages/
  hooks/
  lib/
    api.ts
    types.ts
    native.ts
  App.tsx

For the current prototype everything is kept compact in `src/App.tsx` so it is easy to inspect and run.
