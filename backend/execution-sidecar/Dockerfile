FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
CMD ["npm", "start"]
