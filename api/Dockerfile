# RenovateConnect API container. Single-stage for reliability; the image carries
# the Prisma CLI so it can run `migrate deploy` on boot.
FROM node:20-slim

WORKDIR /app

# Prisma needs OpenSSL on the slim image.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Install deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# App source (.dockerignore keeps tests/uploads/.env out).
COPY . .
RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 3000

# Apply any pending migrations, then start. (Render can alternatively run the
# migration as a preDeploy step; doing it here keeps a plain `docker run` correct.)
CMD ["sh", "-c", "npx prisma migrate deploy && node src/app.js"]
