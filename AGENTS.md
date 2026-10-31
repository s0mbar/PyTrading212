# AGENTS.md

Guidelines for AI/code agents working in this repository.

------------------------------------------------------------------------

## 🧠 Project Philosophy

-   Work incrementally and preserve existing behavior unless explicitly
    requested
-   Prefer small, reversible changes
-   Always prioritize readability and maintainability over cleverness
-   Optimize for developer experience (DX) and fast feedback loops

------------------------------------------------------------------------

## 🏗️ Architecture Overview

-   Frontend: React (TypeScript + Vite + pnpm)
-   Backend: Python (modern stack with uv)
-   Environment: Containerized with Docker
-   Configuration: Single root `.env`

------------------------------------------------------------------------

## 📦 Package Management (MANDATORY)

### Python

-   Use **uv** (Astral) for all dependency management
-   Use `pyproject.toml` (NO requirements.txt)

Commands: uv add `<pkg>`{=html} uv sync uv remove `<pkg>`{=html}

NEVER use: - pip - virtualenv manually

------------------------------------------------------------------------

### Frontend (React)

-   Use **pnpm ONLY**

Commands: pnpm install pnpm add `<pkg>`{=html} pnpm add -D
`<pkg>`{=html} pnpm lint

NEVER use npm or yarn

------------------------------------------------------------------------

## 🐳 Container Strategy

Use Docker for: - Production - Integration testing - CI/CD

Local development: - Hybrid approach allowed

Rules: - Use `docker compose` - No version field - Multi-stage builds
required

------------------------------------------------------------------------

## 📁 Project Structure

.
├── .env
├── README.md
├── AGENTS.md
├── docker/
├── frontend/
├── backend/
├── tests/
├── logs/
└── deploy/

------------------------------------------------------------------------

## 🎯 Code Quality

- Apply Clean Code principles:
  - KISS: implement the simplest solution that works.
  - DRY: avoid duplication; reuse focused functions.
  - YAGNI: build only what is needed now.
  - Readability first: explicit names for variables, functions, and modules.
- Apply SOLID where relevant:
  - SRP: one responsibility per function/class.
  - OCP: extend behavior without risky edits to stable code.
  - LSP: subtype behavior must remain substitutable.
  - ISP: prefer narrow, focused interfaces.
  - DIP: business logic depends on abstractions, not concrete implementations.
- Prefer composition over inheritance when it improves clarity.
- Keep functions short, cohesive, and testable.

Python: - Type hints required - Use pydantic - Use ruff

React: - TypeScript required - Functional components

------------------------------------------------------------------------

## ✅ Test & Quality Gates

- Prefer TDD when implementing new behavior:
  - Red: write a failing test.
  - Green: write minimal code to pass.
  - Refactor: improve code while tests stay green.
- Use AAA test structure:
  - Arrange
  - Act
  - Assert
- Add regression tests for bug fixes.

Python: ruff format . ruff check --fix . pytest

Frontend: pnpm lint --fix pnpm build

------------------------------------------------------------------------

## 🔐 Security

-   No secrets in code
-   Use root .env
-   Validate inputs

------------------------------------------------------------------------

## 🚀 Commands

cd docker docker compose up -d --build

docker compose logs -f SERVICE

------------------------------------------------------------------------

## 🚫 Forbidden

-   pip, npm
-   hardcoded secrets
-   multiple .env

------------------------------------------------------------------------

## ✅ Deployment

-   Tests pass
-   Lint OK
-   Docker OK
