FROM node:22-bookworm-slim

WORKDIR /workspace

COPY plugin.tgz /tmp/opencode-image-comprehension.tgz
COPY docker-packed-runner.mjs /workspace/docker-packed-runner.mjs
COPY test-image.png /workspace/test-image.png

RUN npm init -y \
  && npm install -g opencode-ai \
  && npm install /tmp/opencode-image-comprehension.tgz

CMD ["node", "/workspace/docker-packed-runner.mjs"]
