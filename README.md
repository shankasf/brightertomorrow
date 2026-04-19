# Brighter Tomorrow Therapy — Clone

Full-stack rebuild of brightertomorrowtherapy.com.

- **web/** — Next.js 15 (App Router, TS, Tailwind, Framer Motion) frontend + API routes
- **ai/** — Python (FastAPI + OpenAI Agents SDK) chatbot service
- **db/** — Postgres schema + seed (applied to the `app` DB in `../postgres_db`)

## Stack

| Layer       | Tech                                                       |
| ----------- | ---------------------------------------------------------- |
| Frontend    | Next.js 15, React 19, Tailwind, Framer Motion              |
| API         | Next.js Route Handlers (`/api/contact`, `/api/faqs`, `/api/chat`) |
| Database    | PostgreSQL 17 (in `../postgres_db` docker compose), schema `bt` |
| AI service  | FastAPI on `:8001`, OpenAI Agents SDK, function tools backed by Postgres |

## Run

```bash
# 1. DB is already running in ../postgres_db (postgres:17-alpine)
#    Schema + seed have already been applied. To re-apply:
#    docker exec -i postgres_db psql -U app -d app < db/schema.sql
#    docker exec -i postgres_db psql -U app -d app < db/seed.sql

# 2. Web
cd web
npm install
npm run dev          # http://localhost:3000

# 3. AI service (chatbot)
cd ../ai
cp .env.example .env # add OPENAI_API_KEY
./run.sh             # http://127.0.0.1:8001  (proxied at /api/ai/* + /api/chat)
```

If `OPENAI_API_KEY` is missing, the chat widget still works — it just returns a
graceful fallback message.

## DB schema (highlights)

All tables live in the `bt` schema:

- `site_settings` (singleton) — brand, colors, hours, social
- `nav_items` (header/footer, parent_id for dropdowns)
- `services`, `specialties`, `team_groups`, `team_members`
- `testimonials`, `faqs`, `stats`, `blog_posts`, `locations`
- `contact_submissions` (form + chat-agent intake captures)
- `chat_sessions` / `chat_messages` (agent transcripts)
