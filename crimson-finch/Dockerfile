# The demo app on the tori.host homepage. `npx tori.host` finds this file and
# deploys the directory as a service ("Dockerfile found: a service").
#
# What Tori asks of a service image, and this one does: listen on 8080, and
# run as a numeric non-root user.
# Pinned by digest, so the base changes only in a commit that passed the tests.
# Dependabot moves it.
FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
# The server needs node and nothing else. npm, npx, corepack and yarn come
# with the image, never run here, and carry most of its advisories.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER 1000
CMD ["node", "server.mjs"]
