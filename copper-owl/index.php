<?php

declare(strict_types=1);

// copper owl's front controller, and the only file a request ever reaches.
//
// On Tori, the Caddyfile next to this sends every path here; on your machine
// `php -S localhost:8080 index.php` does the same, because a router script
// that never returns false is asked about every path. The code it runs is in
// src/, and src/ is never served: there is no route to it.

if (PHP_VERSION_ID < 80300) {
    http_response_code(500);
    exit("copper owl needs PHP 8.3 or newer.\n");
}

// An error goes to the log, never into a page.
ini_set('display_errors', '0');

require __DIR__ . '/src/app.php';

$headers = [];
foreach ($_SERVER as $name => $value) {
    if (str_starts_with($name, 'HTTP_')) {
        $headers[strtolower(str_replace('_', '-', substr($name, 5)))] = $value;
    }
}

try {
    [$status, $responseHeaders, $body] = CopperOwl\handle(
        $_SERVER['REQUEST_METHOD'] ?? 'GET',
        $_SERVER['REQUEST_URI'] ?? '/',
        $headers,
        $_POST,
        (int) ($_SERVER['CONTENT_LENGTH'] ?? 0),
    );
} catch (Throwable $error) {
    // The message names the file and line, never what was posted.
    error_log(sprintf('copper owl: %s at %s:%d', get_class($error), $error->getFile(), $error->getLine()));
    [$status, $responseHeaders, $body] = CopperOwl\text(500, 'Something went wrong here.');
}

// PHP announces its version in X-Powered-By unless told not to.
header_remove('X-Powered-By');
http_response_code($status);
foreach (CopperOwl\SECURITY_HEADERS + $responseHeaders as $name => $value) {
    header("$name: $value");
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
    echo $body;
}
