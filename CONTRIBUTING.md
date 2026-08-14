# Contributing to ChitForge

Thank you for contributing. ChitForge is intended to remain frontend-only, privacy-conscious, and evidence-first.

## Local Setup

```bash
npm install
npm run dev
```

## Checks Before Opening a PR

```bash
npm run lint
npm run build
```

## Contribution Standards

- Do not commit API keys, credentials, or private configuration.
- Keep the Gemini key user-provided and browser-local.
- Prefer primary sources for generation prompts and evidence handling.
- Do not add backend calls to project-controlled servers.
- Preserve the map's real geographic data source and attribution.
- Keep follow-up generation optional.
- Ensure zero selected targets remains valid in Automatic and Hybrid modes.
