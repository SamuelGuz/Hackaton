# Claude Code Instructions

This is the Churn Oracle project for the GTM Hackathon.

## Required reading before any task
1. plan.md — overall project plan and roles
2. CONTRACTS.md — schemas, APIs, webhooks (single source of truth)

## Project conventions
- Python + FastAPI backend in /backend
- React + Vite frontend in /frontend
- Supabase for database (UUIDs as PKs)
- All schemas in CONTRACTS.md section 1
- All API contracts in CONTRACTS.md section 2

## Critical rules
- NEVER invent fields not in CONTRACTS.md
- ALWAYS use the snake_case convention
- If a contract needs to change, update CONTRACTS.md FIRST, then code