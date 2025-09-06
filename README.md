# Badminton Tournament Backend (Starter)

## Quick Start
1) Install deps
   ```bash
   cd backend
   npm i
   ```
2) Copy env
   ```bash
   cp .env.sample .env
   # then edit MONGO_URI if needed
   ```
3) Run dev
   ```bash
   npm run dev
   ```

## Health Check
GET http://localhost:4000/api/health -> {"ok": true}

## Key Endpoints
- POST   /api/teams
- GET    /api/teams
- GET    /api/teams/group/:name
- GET    /api/matches?round=Group%20A
- PUT    /api/matches/:id
- POST   /api/tournaments/generate-groups
- POST   /api/tournaments/generate-knockout
- GET    /api/tournaments/overview
