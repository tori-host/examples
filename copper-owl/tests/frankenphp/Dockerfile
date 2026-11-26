# The image Tori builds for copper owl, near enough to test what only
# FrankenPHP does: the Caddyfile's routing and its body cap. tests/frankenphp.sh
# builds it; Tori does not, because this is not at the root of the directory.
#
# What Railpack v0.39.0 does with a PHP app and no Dockerfile, mirrored here:
# a dunglas/frankenphp base for the PHP version it picks (8.4 when nothing
# asks for another), the app in /app, the app's own Caddyfile at /Caddyfile,
# the two php.ini settings of Railpack's that matter to this app, and the same
# start command. Tori then runs the image as uid 1000, which owns /app.
FROM dunglas/frankenphp:php8.4.28-trixie@sha256:61ea4bb945e3a85826e28df012cbcea3ef7f0d73c993f6c700b872e99c0f9f4b
RUN printf 'expose_php = On\npost_max_size = 0\ndisplay_errors = Off\n' > /usr/local/etc/php/conf.d/railpack.ini
COPY Caddyfile /Caddyfile
COPY --chown=1000:1000 . /app
WORKDIR /app
USER 1000
CMD ["docker-php-entrypoint", "--config", "/Caddyfile", "--adapter", "caddyfile"]
