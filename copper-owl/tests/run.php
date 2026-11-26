<?php

declare(strict_types=1);

// copper owl's tests, with nothing to install: `php tests/run.php`.
//
// The sums and the form rules are tested as functions. Everything a visitor
// can reach is tested over HTTP: against `php -S` started here, or, with
// COPPER_OWL_URL set, against a server that is already running, which is how
// tests/frankenphp.sh runs the same cases against FrankenPHP and the
// Caddyfile, the way Tori serves the app. Exits 1 if anything fails.

if (PHP_SAPI !== 'cli') {
    // Not a page: the Caddyfile never routes here, and this keeps it so.
    http_response_code(404);
    exit;
}

require __DIR__ . '/../src/app.php';

use function CopperOwl\{formatMoney, formatQuantity, fromAnotherSite, parseDate, parseDecimal, readForm, totals};

$failed = 0;
$passed = 0;

function test(string $name, callable $body): void
{
    global $failed, $passed;
    try {
        $body();
        $passed++;
        echo "ok   $name\n";
    } catch (Throwable $error) {
        $failed++;
        echo "FAIL $name\n     {$error->getMessage()}\n";
    }
}

function same(mixed $expected, mixed $actual, string $what = ''): void
{
    if ($expected !== $actual) {
        throw new Exception(sprintf('%sexpected %s, got %s', $what === '' ? '' : "$what: ", var_export($expected, true), var_export($actual, true)));
    }
}

function truthy(bool $condition, string $what): void
{
    if (!$condition) throw new Exception($what);
}

/** A form as the page posts it, filled in; $change overrides fields. */
function form(array $change = []): array
{
    return array_replace_recursive([
        'number' => '2026-0042',
        'issued' => '2026-11-26',
        'due' => '2026-12-10',
        'currency' => 'CZK',
        'seller_name' => 'Owl & Sons s.r.o.',
        'seller_address' => "Sovova 1\n110 00 Praha 1",
        'seller_tax_id' => 'CZ12345678',
        'buyer_name' => 'Wren Ltd',
        'buyer_address' => '',
        'buyer_tax_id' => '',
        'lines' => [
            ['description' => 'Owl boxes', 'quantity' => '3', 'price' => '33.33', 'vat' => '21'],
            ['description' => 'Installation', 'quantity' => '1,5', 'price' => '0.33', 'vat' => '12'],
            ['description' => '', 'quantity' => '', 'price' => '', 'vat' => '21'],
        ],
    ], $change);
}

// ---------------------------------------------------------------- the sums

test('decimals are read into whole units, not floats', function () {
    same(1500, parseDecimal('1.5', 5, 3));
    same(1500, parseDecimal('1,5', 5, 3), 'a comma is a decimal point');
    same(3333, parseDecimal('33.33', 8, 2));
    same(30, parseDecimal('0.3', 8, 2));
    // Through a float, 0.29 × 100 is 28.999999999999996 and 4.35 × 100 is
    // 434.99999999999994: cut to an int, a cent short.
    same(29, parseDecimal('0.29', 8, 2));
    same(435, parseDecimal('4.35', 8, 2));
    same(0, parseDecimal('0', 8, 2));
    foreach (['-1', '+1', '1e3', '1.2345', '1.', '.5', '1 000', '1,000.00', '0x10', '', '123456'] as $bad) {
        same(null, parseDecimal($bad, 5, 3), "'$bad'");
    }
});

test('0.10 + 0.20 is 0.30, and its VAT rounds half up', function () {
    $sums = totals([
        ['description' => 'a', 'milli' => 1000, 'minor' => 10, 'vat' => 21],
        ['description' => 'b', 'milli' => 1000, 'minor' => 20, 'vat' => 21],
    ]);
    same(30, $sums['net']);
    same(6, $sums['vat'], '21 % of 0.30 is 0.063');
    same(36, $sums['total']);
    // 21 % of 0.50 is exactly 0.105: half up makes it 0.11.
    same(11, totals([['description' => 'c', 'milli' => 1000, 'minor' => 50, 'vat' => 21]])['vat']);
});

test('a line is quantity times price, rounded half up once', function () {
    $line = fn (int $milli, int $minor) => totals([['description' => 'x', 'milli' => $milli, 'minor' => $minor, 'vat' => 0]])['lines'][0]['total'];
    same(9999, $line(3000, 3333), '3 × 33.33');
    same(50, $line(1500, 33), '1.5 × 0.33 = 0.495');
    same(333, $line(333, 1000), '0.333 × 10.00');
    same(101, $line(1005, 100), '1.005 × 1.00 = 1.005');
    same(100, $line(1004, 100), '1.004 × 1.00');
});

test('VAT is worked out per rate, on the sum of that rate', function () {
    $sums = totals([
        ['description' => 'a', 'milli' => 1000, 'minor' => 1000, 'vat' => 21],
        ['description' => 'b', 'milli' => 1000, 'minor' => 10000, 'vat' => 12],
        ['description' => 'c', 'milli' => 1000, 'minor' => 1, 'vat' => 21],
        ['description' => 'd', 'milli' => 2000, 'minor' => 250, 'vat' => 0],
    ]);
    same([
        ['rate' => 0, 'base' => 500, 'vat' => 0, 'total' => 500],
        ['rate' => 12, 'base' => 10000, 'vat' => 1200, 'total' => 11200],
        // 21 % of 10.01 is 2.1021.
        ['rate' => 21, 'base' => 1001, 'vat' => 210, 'total' => 1211],
    ], $sums['rates']);
    same(11501, $sums['net']);
    same(1410, $sums['vat']);
    same(12911, $sums['total']);
    // Three lines of 0.03 at 21 %: 0.0063 each would round to 0.01 each, 0.03
    // in all, while the VAT on their 0.09 is 0.0189, which is 0.02.
    same(2, totals(array_fill(0, 3, ['description' => 'e', 'milli' => 1000, 'minor' => 3, 'vat' => 21]))['vat'], '21 % of 0.09');
});

test('the largest line the bounds allow is still an exact integer', function () {
    $milli = parseDecimal('99999.999', 5, 3);
    $minor = parseDecimal('99999999.99', 8, 2);
    $sums = totals(array_fill(0, 10, ['description' => 'x', 'milli' => $milli, 'minor' => $minor, 'vat' => 21]));
    // 99,999.999 × 99,999,999.99 is 9,999,999,899,000.00001: in thousandths
    // of a cent, 9.99e17, which is still under PHP_INT_MAX. One more digit
    // in either bound and PHP would quietly make it a float.
    same(999999989900000, $sums['lines'][0]['total']);
    same(9999999899000000, $sums['net']);
    same(2099999978790000, $sums['vat']);
    foreach (['net', 'vat', 'total'] as $sum) truthy(is_int($sums[$sum]), "the $sum is an int, not a float");
});

test('money and quantities are printed without losing a digit', function () {
    same('1,234.56', formatMoney(123456));
    same('0.05', formatMoney(5));
    same('0.00', formatMoney(0));
    same('99,999,998,990,000.00', formatMoney(9999999899000000));
    same('1.5', formatQuantity(1500));
    same('2', formatQuantity(2000));
    same('0.003', formatQuantity(3));
});

// --------------------------------------------------------------- the form

test('a filled-in form makes an invoice, and empty lines are left out', function () {
    [, $errors, $invoice] = readForm(form());
    same([], $errors);
    same(2, count($invoice['sums']['lines']));
    // 3 × 33.33 = 99.99 at 21 %, 1.5 × 0.33 = 0.50 at 12 %.
    same(10049, $invoice['sums']['net']);
    same(2100 + 6, $invoice['sums']['vat'], '21 % of 99.99 is 21.00 (20.9979), 12 % of 0.50 is 0.06');
});

test('more than ten lines are refused', function () {
    $lines = array_fill(0, 11, ['description' => 'x', 'quantity' => '1', 'price' => '1', 'vat' => '21']);
    [, $errors, $invoice] = readForm(['lines' => $lines] + form());
    same(null, $invoice);
    truthy(isset($errors['form']), 'a message for the form');
    // Ten are fine.
    [, $errors] = readForm(['lines' => array_slice($lines, 0, 10)] + form());
    same([], $errors);
    // And a line numbered past the tenth is the same as an eleventh.
    [, $errors] = readForm(['lines' => [10 => $lines[0]]] + form());
    truthy(isset($errors['form']), 'line index 10 is refused');
});

test('every text field is bounded, and an overlong value is not shown again', function () {
    [$values, $errors] = readForm(form(['seller_name' => str_repeat('o', 121)]));
    truthy(isset($errors['seller_name']), '121 characters');
    same('', $values['seller_name']);
    [, $errors] = readForm(form(['seller_name' => str_repeat('ř', 120)]));
    same([], $errors, '120 characters of two bytes each are 120 characters');
    [, $errors] = readForm(form(['lines' => [0 => ['description' => str_repeat('d', 121)]]]));
    truthy(isset($errors['lines.0.description']), 'a 121-character description');
    [, $errors] = readForm(form(['buyer_address' => "1\n2\n3\n4\n5"]));
    truthy(isset($errors['buyer_address']), 'five address lines');
    [, $errors] = readForm(form(['number' => str_repeat('1', 31)]));
    truthy(isset($errors['number']), 'a 31-character number');
});

test('quantities, prices, rates and currencies are bounded', function () {
    $line = fn (array $l) => readForm(form(['lines' => [0 => $l]]))[1];
    truthy(isset($line(['quantity' => '-1'])['lines.0.quantity']), 'a negative quantity');
    truthy(isset($line(['quantity' => '0'])['lines.0.quantity']), 'a zero quantity');
    truthy(isset($line(['quantity' => '100000'])['lines.0.quantity']), 'a quantity of 100,000');
    truthy(isset($line(['price' => '-0.01'])['lines.0.price']), 'a negative price');
    truthy(isset($line(['price' => '100000000'])['lines.0.price']), 'a price of 100,000,000');
    truthy(isset($line(['price' => '1.001'])['lines.0.price']), 'a price in thousandths');
    truthy(isset($line(['vat' => '15'])['lines.0.vat']), 'a VAT rate not on the list');
    same([], $line(['price' => '0']), 'a free line is a line');
    truthy(isset(readForm(form(['currency' => 'GBP']))[1]['currency']), 'a currency not on the list');
});

test('dates are calendar dates, and the due date is not before the issue', function () {
    same('2028-02-29', parseDate('2028-02-29'));
    same(null, parseDate('2027-02-29'));
    same(null, parseDate('26.11.2026'));
    same(null, parseDate(['2026-11-26']));
    truthy(isset(readForm(form(['due' => '2026-11-25']))[1]['due']), 'due the day before issue');
});

test('control and direction-override characters are refused', function () {
    truthy(isset(readForm(form(['seller_name' => "Owl\nInc"]))[1]['seller_name']), 'a line break in a one-line field');
    truthy(isset(readForm(form(['seller_name' => "Owl\u{202E}cnI"]))[1]['seller_name']), 'a right-to-left override');
    truthy(isset(readForm(form(['seller_name' => "\xC3\x28"]))[1]['seller_name']), 'invalid UTF-8');
    same([], readForm(form(['seller_address' => "Sovova 1\r\nPraha"]))[1], 'line breaks in an address');
});

test('a form that is not shaped like this one is refused whole', function () {
    truthy(isset(readForm(form(['seller_name' => ['a', 'b']]))[1]['form']), 'an array for a text field');
    truthy(isset(readForm(['lines' => 'x'] + form())[1]['form']), 'a string for the lines');
    truthy(isset(readForm(form(['lines' => [0 => ['description' => ['x']]]]))[1]['form']), 'an array inside a line');
    truthy(isset(readForm(['lines' => []] + form())[1]['lines']), 'no lines at all');
});

test('fromAnotherSite: the browser’s word first, then Origin against Host', function () {
    same(false, fromAnotherSite(['sec-fetch-site' => 'same-origin', 'origin' => 'https://evil.example', 'host' => 'a.example']));
    same(false, fromAnotherSite(['sec-fetch-site' => 'none']));
    same(true, fromAnotherSite(['sec-fetch-site' => 'cross-site', 'origin' => 'https://a.example', 'host' => 'a.example']));
    // Another app on tori.cloud is the same site and not the same origin.
    same(true, fromAnotherSite(['sec-fetch-site' => 'same-site']));
    same(false, fromAnotherSite(['origin' => 'https://a.example', 'host' => 'a.example']));
    same(false, fromAnotherSite(['origin' => 'http://127.0.0.1:8080', 'host' => '127.0.0.1:8080']));
    same(true, fromAnotherSite(['origin' => 'https://evil.example', 'host' => 'a.example']));
    same(true, fromAnotherSite(['origin' => 'null', 'host' => 'a.example']));
    same(false, fromAnotherSite(['host' => 'a.example']), 'neither header: not a browser acting for a site');
});

// ------------------------------------------------------------ over HTTP

$root = dirname(__DIR__);
$base = getenv('COPPER_OWL_URL') ?: null;
$server = null;
if ($base === null) {
    // A free port, then `php -S` with index.php as the router, as the README
    // tells a visitor to run it.
    $probe = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int) substr(strrchr(stream_socket_get_name($probe, false), ':'), 1);
    fclose($probe);
    $base = "http://127.0.0.1:$port";
    $server = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", 'index.php'], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $root);
    register_shutdown_function(fn () => proc_terminate($server));
}
$target = parse_url($base);
$hostPort = $target['host'] . ':' . ($target['port'] ?? 80);

/**
 * One request over a fresh connection, in HTTP/1.0 so that no answer comes
 * chunked. Returns [status, headers with lower-case names, body].
 */
function request(string $method, string $path, array $headers = [], string $body = ''): array
{
    global $target, $hostPort;
    $socket = @stream_socket_client("tcp://{$target['host']}:" . ($target['port'] ?? 80), $code, $message, 5);
    if ($socket === false) throw new Exception("cannot connect: $message");
    $headers += ['Host' => $hostPort, 'Connection' => 'close'];
    if ($method === 'POST') $headers += ['Content-Type' => 'application/x-www-form-urlencoded', 'Content-Length' => (string) strlen($body)];
    $head = "$method $path HTTP/1.0\r\n";
    foreach ($headers as $name => $value) $head .= "$name: $value\r\n";
    fwrite($socket, "$head\r\n$body");
    $response = stream_get_contents($socket);
    fclose($socket);
    [$rawHead, $responseBody] = explode("\r\n\r\n", $response, 2) + [1 => ''];
    $lines = explode("\r\n", $rawHead);
    $status = (int) explode(' ', array_shift($lines))[1];
    $parsed = [];
    foreach ($lines as $line) {
        [$name, $value] = explode(':', $line, 2);
        $parsed[strtolower(trim($name))] = trim($value);
    }
    return [$status, $parsed, $responseBody];
}

function post(array $fields, array $headers = ['Sec-Fetch-Site' => 'same-origin']): array
{
    return request('POST', '/invoice', $headers, http_build_query($fields));
}

function hasSecurityHeaders(array $headers, string $where): void
{
    truthy(str_contains($headers['content-security-policy'] ?? '', "default-src 'none'"), "$where: a strict CSP");
    truthy(!str_contains($headers['content-security-policy'] ?? '', 'script-src'), "$where: no script source allowed");
    same('nosniff', $headers['x-content-type-options'] ?? null, "$where: nosniff");
    same('same-origin', $headers['referrer-policy'] ?? null, "$where: Referrer-Policy");
    same('noindex', $headers['x-robots-tag'] ?? null, "$where: X-Robots-Tag");
    same(null, $headers['x-powered-by'] ?? null, "$where: no X-Powered-By");
}

$up = false;
for ($i = 0; $i < 50 && !$up; $i++) {
    try {
        $up = request('GET', '/healthz')[0] === 200;
    } catch (Throwable) {
        usleep(100_000);
    }
}
test("the server answers at $base", fn () => truthy($up, 'no answer from /healthz'));

if ($up) {
    test('GET / is the form, with the markers the repository checks', function () {
        [$status, $headers, $body] = request('GET', '/');
        same(200, $status);
        same('text/html; charset=utf-8', $headers['content-type'] ?? null);
        hasSecurityHeaders($headers, 'GET /');
        foreach (['data-example="copper-owl"', 'an example run by', 'href="https://tori.host/"', 'Prague, EU', 'https://github.com/tori-host/examples/tree/main/copper-owl', '<meta name="robots" content="noindex" />', 'action="/invoice"'] as $needle) {
            truthy(str_contains($body, $needle), "the page has $needle");
        }
        same(10, substr_count($body, '[description]'), 'ten lines on the form');
        truthy(!str_contains($body, '<script'), 'no script on the page');
    });

    test('GET /healthz is ok, and so are the assets', function () {
        [$status, $headers, $body] = request('GET', '/healthz');
        same([200, "ok\n"], [$status, $body]);
        hasSecurityHeaders($headers, '/healthz');
        [$status, $headers, $body] = request('GET', '/style.css');
        same(200, $status);
        same('text/css; charset=utf-8', $headers['content-type'] ?? null);
        truthy(str_contains($body, '@media print'), 'the stylesheet has print rules');
        hasSecurityHeaders($headers, '/style.css');
        same(200, request('GET', '/favicon.svg')[0]);
    });

    test('POST /invoice draws the invoice with its sums and the sample mark', function () {
        [$status, $headers, $body] = post(form());
        same(200, $status);
        hasSecurityHeaders($headers, 'the invoice');
        same('no-store', $headers['cache-control'] ?? null, 'no cache keeps an invoice');
        foreach (['Owl &amp; Sons s.r.o.', 'Sovova 1<br />110 00 Praha 1', '99.99 CZK', '0.50 CZK', '21.00 CZK', '0.06 CZK', '100.49 CZK', '121.55 CZK', '1.5'] as $needle) {
            truthy(str_contains($body, $needle), "the invoice has $needle");
        }
        same(2, substr_count($body, 'SAMPLE — made with an example app, not a real invoice'), 'the mark at the top and the foot');
        truthy(str_contains($body, 'data-example="copper-owl"'), 'the marker is on the invoice too');
    });

    test('text from a field comes out escaped, never as markup or a link', function () {
        $evil = '<script>alert(1)</script>';
        [$status, , $body] = post(form([
            'seller_name' => $evil,
            'buyer_address' => "https://evil.example/\n\"><img src=x onerror=alert(1)>",
            'lines' => [0 => ['description' => '<a href="https://evil.example/">pay here</a>']],
        ]));
        same(200, $status);
        truthy(str_contains($body, '&lt;script&gt;alert(1)&lt;/script&gt;'), 'the script tag is text');
        truthy(!str_contains($body, '<script'), 'no script element');
        truthy(!str_contains($body, '<img src=x'), 'no image element');
        truthy(!str_contains($body, '<a href="https://evil.example/">'), 'no link from a description');
        truthy(!preg_match('~href="https://evil~', $body), 'no href from an address');
        truthy(!str_contains($body, '"><img'), 'no attribute escape in the hidden fields');
    });

    test('a refused form is a 400 with the form and the messages', function () {
        $lines = array_fill(0, 11, ['description' => 'x', 'quantity' => '1', 'price' => '1', 'vat' => '21']);
        foreach ([
            'eleven lines' => ['lines' => $lines] + form(),
            'an overlong name' => form(['seller_name' => str_repeat('o', 121)]),
            'a negative quantity' => form(['lines' => [0 => ['quantity' => '-2']]]),
            'a rate not on the list' => form(['lines' => [0 => ['vat' => '20']]]),
        ] as $what => $fields) {
            [$status, $headers, $body] = post($fields);
            same(400, $status, $what);
            hasSecurityHeaders($headers, $what);
            truthy(str_contains($body, 'action="/invoice"'), "$what: the form is back");
            truthy(str_contains($body, 'role="alert"'), "$what: with the messages");
            truthy(!str_contains($body, 'class="invoice"'), "$what: and no invoice");
        }
        [, , $body] = post(form(['seller_name' => str_repeat('o', 121)]));
        truthy(!str_contains($body, str_repeat('o', 121)), 'an overlong value is not shown again');
    });

    test('a post from another site is refused with 403, and shows nothing of it', function () {
        $marker = 'CROSS-SITE-' . bin2hex(random_bytes(4));
        foreach ([
            'Sec-Fetch-Site: cross-site' => ['Sec-Fetch-Site' => 'cross-site'],
            'Sec-Fetch-Site: same-site' => ['Sec-Fetch-Site' => 'same-site'],
            'another Origin' => ['Origin' => 'https://evil.example'],
            'Origin: null' => ['Origin' => 'null'],
        ] as $what => $headers) {
            [$status, $responseHeaders, $body] = post(form(['seller_name' => $marker]), $headers);
            same(403, $status, $what);
            hasSecurityHeaders($responseHeaders, $what);
            truthy(!str_contains($body, $marker), "$what: the text is not shown");
        }
        global $hostPort;
        same(200, post(form(), ['Origin' => "http://$hostPort"])[0], 'its own Origin');
    });

    test('no URL shows submitted text: GET /invoice with a query is not an invoice', function () {
        $marker = 'FROM-A-LINK-' . bin2hex(random_bytes(4));
        $query = http_build_query(form(['seller_name' => $marker, 'number' => $marker]));
        [$status, $headers, $body] = request('GET', "/invoice?$query");
        same(405, $status);
        same('POST', $headers['allow'] ?? null);
        truthy(!str_contains($body, $marker), 'GET /invoice?… does not draw it');
        [$status, , $body] = request('GET', "/?$query");
        same(200, $status);
        truthy(!str_contains($body, $marker), 'GET /?… does not fill the form with it');
        [$status, , $body] = request('GET', "/$marker");
        same(404, $status);
        truthy(!str_contains($body, $marker), 'a path is not repeated either');
    });

    test('an unknown path is a 404 with the same headers', function () {
        [$status, $headers] = request('GET', '/nope');
        same(404, $status);
        hasSecurityHeaders($headers, '404');
        same(405, request('POST', '/', ['Sec-Fetch-Site' => 'same-origin'])[0], 'POST /');
        [$status, , $body] = request('HEAD', '/');
        same([200, ''], [$status, $body], 'HEAD / has no body');
    });

    test('no source file is served, by any path', function () {
        foreach (['/index.php', '/src/app.php', '/src/invoice.php', '/src/page.html', '/tests/run.php', '/Caddyfile', '/README.md', '/.gitignore', '/assets/style.css', '/src/', '/src', '/src/app.php/', '//src/app.php', '/./src/app.php', '/%73rc/app.php', '/tests/frankenphp.sh'] as $path) {
            [$status, $headers, $body] = request('GET', $path);
            same(404, $status, $path);
            same('noindex', $headers['x-robots-tag'] ?? null, "$path: X-Robots-Tag");
            truthy(!str_contains($body, '<?php') && !str_contains($body, '{{main}}') && !str_contains($body, 'namespace'), "$path: no source in the answer");
        }
    });

    test('a body larger than the form can send is refused', function () {
        [$status, $headers] = post(form(['seller_name' => str_repeat('x', 70 * 1024)]));
        same(413, $status);
        hasSecurityHeaders($headers, '413');
    });

    test('"Change something" brings the form back filled in, from the posted values only', function () {
        [$status, $headers, $body] = post(form() + ['edit' => '1']);
        same(200, $status);
        same('no-store', $headers['cache-control'] ?? null);
        truthy(str_contains($body, 'value="Owl &amp; Sons s.r.o."'), 'the seller is filled in');
        truthy(str_contains($body, 'value="1,5"'), 'the quantity as it was typed');
        truthy(!str_contains($body, 'class="invoice"'), 'the form, not the invoice');
    });
}

echo "\n$passed passed, $failed failed\n";
exit($failed === 0 ? 0 : 1);
