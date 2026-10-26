FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY tsconfig.json ./
COPY packages packages
COPY apps/server apps/server
RUN npm run build -w apps/server
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY package.json ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node","dist/apps/server/src/index.js"]
