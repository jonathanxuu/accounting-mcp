FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

ENV PORT=4010
ENV HOST=0.0.0.0

EXPOSE 4010

CMD ["npm", "run", "start"]
