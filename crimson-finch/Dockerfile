# The demo app on the tori.host homepage. `npx tori.host` finds this file and
# deploys the directory as a service ("Dockerfile found: a service").
#
# What Tori asks of a service image, and this one does: listen on 8080, and
# run as a numeric non-root user.
# Pinned by digest, so the base changes only in a commit that passed the tests.
# Dependabot moves it.
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER 1000
CMD ["node", "server.mjs"]
