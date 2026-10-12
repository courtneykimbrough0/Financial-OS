# Financial OS on Cloud Run: build the app, then serve it with server.mjs.
# Cloud Run sets $PORT; the server listens on it.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# The server has no dependencies: it needs only itself, the Firebase settings
# (for the sign-in address) and the built app.
COPY --from=build /app/server.mjs /app/firebase-applet-config.json ./
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "server.mjs"]
