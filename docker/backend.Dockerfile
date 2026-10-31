FROM ghcr.io/astral-sh/uv:python3.12-bookworm AS builder
WORKDIR /app/backend
COPY backend/pyproject.toml ./pyproject.toml
RUN uv sync --frozen --no-dev

FROM python:3.12-slim AS runtime
WORKDIR /app/backend
COPY --from=builder /app/backend/.venv /app/backend/.venv
COPY backend/src ./src
ENV PATH="/app/backend/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8000"]
