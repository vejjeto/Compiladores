# AGENTS.md

## Project

University compilers project: robotic vehicle control via HTTP/WebSocket using encrypted 5-digit numeric blocks. Transmitter/Receiver SPA communicates with an ESP32 car (or local simulator).

## Architecture (Monorepo)

```
Backend/        Node.js ESM server (port 3000) — API + WebSocket + serves Frontend static files
Frontend/       Vanilla JS SPA (no framework, no build step)
simulador/      ESP32 car simulator (port 8081)
```

Three separate `package.json` files. Backend is the main entrypoint. Frontend has no dependencies — it's served by Backend at runtime.

## Essential Commands

```bash
# Install all packages (must run before anything)
npm install --prefix Backend && npm install --prefix simulador && npm install

# Run tests (Backend only, uses native node:test)
npm test

# Start everything (Backend + simulator concurrently)
npm start

# Start Backend only
npm run start:backend
```

There is no single-package install or test command from root for Frontend or simulador individually. Tests live only in `Backend/test/`.

## Backend Structure

| Path | Role |
|------|------|
| `Backend/server.js` | Main entry — creates HTTP server, wires services, serves Frontend |
| `Backend/src/core/parser.js` | Command parser |
| `Backend/src/core/automatas.js` | AFD for residue classification |
| `Backend/src/core/encriptador.js` | 5-digit block encryption/decryption |
| `Backend/src/adapters/` | WebSocket adapters (car, server, peer) |
| `Backend/src/services/` | Business logic (car, audit, transmisor, tabla) |
| `Backend/src/protocol/` | Communication protocol and commands |
| `Backend/config/tablas.json` | **Dynamic config** — commands, ranges, primes. Loaded at startup. |

## Key Gotchas

- **ESM only**: Both Backend and simulador use `"type": "module"`. Use `import`/`export`, never `require()`.
- **No frontend build**: Frontend is plain JS files served statically. No webpack, no Vite, no compilation.
- **Port 3000**: Backend serves both API and Frontend on the same port. No separate frontend dev server.
- **Port 8081**: Simulator WebSocket endpoint. Hardcoded in simulator.
- **tablas.json is the source of truth** for commands, ranges, and primes. Do not hardcode these values — always read from `tablaService`.
- **Tests use `node --test`**: Native Node.js test runner, not Jest or Mocha. Test files follow `*.test.js` pattern.
- **CI pipeline order**: lint (import checks) → build (syntax checks via `node --check`) → test. The lint step just verifies modules can be imported.
- **skip CI**: Add `-skip` to commit title to skip the entire pipeline.
- **Dependencies are minimal**: Backend only depends on `ws` and `uuid`. Keep it that way.
