FROM node:22-alpine AS builder
WORKDIR /app/frontend
COPY frontend/package.json ./package.json
RUN corepack enable && pnpm install
COPY frontend/ .
RUN pnpm build

FROM nginx:1.28-alpine AS runtime
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]