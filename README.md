# ChitForge

ChitForge is an open-source, frontend-only Model United Nations tactical POI/chit generator. It helps delegates start from a portfolio country's documented interests, discover agenda-relevant pressure points, and generate evidence-based Points of Information with legal/policy framing and source classification.

## Features

- Portfolio-first generation pipeline: agenda, portfolio intelligence, interests, frameworks, target discovery, pressure points, POI construction, validation, and export.
- Optional targeting: Automatic, Manual, and Hybrid modes. Zero selected targets is valid in Automatic/Hybrid mode.
- Real geographic SVG world map using Natural Earth geometry through `world-atlas`, rendered with `topojson-client` and `d3-geo`.
- Multi-select countries with ISO 3166 alpha-3 identifiers, hover tooltips, selected highlighting, and separate portfolio styling.
- Tactical sliders for Aggression, Controversy, Diplomacy, and Length.
- Pressure score and classification derived from sliders, evidence strength, contradiction strength, agenda relevance, and legal/policy relevance.
- Optional follow-ups: disabled by default, available during generation or later from an existing chit.
- Professional Word-compatible `.docx` tactical brief export.
- Frontend-only Gemini integration. The user supplies their own Gemini API key.

## Tech Stack

- React
- Vite
- D3 Geo
- TopoJSON Client
- world-atlas / Natural Earth country geometry
- Browser `sessionStorage` / opt-in `localStorage` for API-key persistence

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Open the Vite URL shown in your terminal, usually `http://localhost:5173`.

## Production Build

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Deployment

ChitForge is a static frontend. Deploy the generated `dist/` directory to any static host, such as GitHub Pages, Netlify, Vercel, Cloudflare Pages, or an internal static server.

## Gemini API Key Setup

1. Create a Gemini API key in Google AI Studio.
2. Open ChitForge in your browser.
3. Paste the key into the Gemini API Key field.
4. By default, the key is stored only in `sessionStorage` and is removed when the browser session ends.
5. Enable **Remember key** only if you explicitly want browser `localStorage` persistence.
6. Use **Clear API Key** to remove stored key data.

ChitForge has no backend and never includes a developer-owned key. The key is sent only from the user's browser to Google's Gemini API endpoint.

## Privacy and Security Model

- No backend server is included.
- No API keys, secrets, private credentials, or developer keys are committed.
- The Gemini key is user-provided.
- Default storage is `sessionStorage`; `localStorage` requires explicit opt-in.
- The application does not log API keys.

## World Map Data Attribution

Country geometry is provided by the `world-atlas` npm package, which distributes Natural Earth public-domain map data in TopoJSON form. Rendering uses `topojson-client` and `d3-geo`. Review upstream package licenses before redistributing modified datasets.

## DOCX Export

The browser creates a Word-compatible `.docx` download containing committee metadata, portfolio intelligence summary, pressure profile, POI, legal/policy foundation, evidence and sources, documented pressure point, legal/tactical classifications, tactical impact, validation, and optional follow-up sections when present.
