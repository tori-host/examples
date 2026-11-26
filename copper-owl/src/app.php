<?php

declare(strict_types=1);

// copper owl: the routes, the headers and the pages. index.php hands every
// request to handle() and sends back what it returns, so the same code runs
// under FrankenPHP on Tori and under `php -S` on your machine.
//
// The page draws whatever a visitor typed, on a domain that is not theirs.
// Three rules keep that from being useful to anyone but the visitor:
//
// - Text reaches a page only as the answer to a POST from this page itself.
//   A post from another site is refused, and nothing in a URL is ever drawn,
//   so there is no link that shows someone else's text.
// - Every invoice says, outside anything a visitor controls and in print too,
//   that it is a sample from an example app.
// - Every field is bounded and escaped, and no link is made from any of it.

namespace CopperOwl;

require_once __DIR__ . '/invoice.php';

const LOCATION = 'Prague, EU';
const SOURCE = 'https://github.com/tori-host/examples/tree/main/copper-owl';
const SAMPLE = 'SAMPLE — made with an example app, not a real invoice';
// The largest form this page can send is about 30 kB, every field full of
// characters that URL-encode to nine bytes each. The Caddyfile has the same
// cap, so FrankenPHP refuses a larger body before PHP reads it.
const MAX_BODY = 64 * 1024;

const SECURITY_HEADERS = [
    // No script at all, and styles from the stylesheet only: escaped text
    // cannot become markup, and if it ever did it could neither run nor
    // restyle the page to hide the sample mark.
    'Content-Security-Policy' => "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options' => 'nosniff',
    // Not `no-referrer`: under it some browsers send `Origin: null` on the
    // page's own form posts, which fromAnotherSite() refuses.
    'Referrer-Policy' => 'same-origin',
    // The pages on tori.host are the ones meant to be found; this copy is not.
    'X-Robots-Tag' => 'noindex',
];

const ASSETS = [
    '/style.css' => ['style.css', 'text/css; charset=utf-8'],
    '/favicon.svg' => ['favicon.svg', 'image/svg+xml'],
];

/**
 * One request in, one response out: [status, headers, body]. $headers are
 * the request headers with lower-case names; $post is the parsed form body.
 */
function handle(string $method, string $uri, array $headers, array $post, int $contentLength): array
{
    // The query is cut off here and never read: no page depends on it, so
    // no URL can put text on one.
    $path = explode('?', $uri, 2)[0];
    $read = $method === 'GET' || $method === 'HEAD';

    if ($path === '/healthz' && $read) return text(200, 'ok');
    if (isset(ASSETS[$path]) && $read) {
        [$file, $type] = ASSETS[$path];
        return [200, ['Content-Type' => $type, 'Cache-Control' => 'public, max-age=300'], file_get_contents(__DIR__ . "/../assets/$file")];
    }
    if ($path === '/' && $read) return html(200, page('An invoice, ready to print', 'form', formView(blankValues(), [])), 'no-cache');

    if ($path === '/invoice') {
        if ($method !== 'POST') return text(405, 'An invoice is made by the form at /, which posts here.', ['Allow' => 'POST']);
        if (fromAnotherSite($headers)) return text(403, 'This example takes invoices from its own page only.');
        if ($contentLength > MAX_BODY) return text(413, 'That is more than the form on this page sends.');

        [$values, $errors, $invoice] = readForm($post);
        // An invoice holds names and addresses: no cache keeps a copy.
        if ($errors !== []) return html(400, page('Some fields need a look', 'form', formView($values, $errors)), 'no-store');
        if (($post['edit'] ?? '') === '1') return html(200, page('An invoice, ready to print', 'form', formView($values, [])), 'no-store');
        return html(200, page('Invoice ' . $invoice['number'] . ' (sample)', 'invoice', invoiceView($invoice, $values)), 'no-store');
    }

    if (!$read && ($path === '/' || $path === '/healthz' || isset(ASSETS[$path]))) {
        return text(405, 'Method not allowed.', ['Allow' => 'GET, HEAD']);
    }
    return text(404, 'Nothing here. The form is at /');
}

/**
 * Whether a post was sent by a page on another site. A browser needs no
 * permission to send a cross-site form, so without this any page on the web
 * could make its visitors' browsers draw that page's text here, on our
 * domain. `Sec-Fetch-Site` is the browser's own statement; where it is
 * absent, `Origin` is compared with the host that was asked. A request with
 * neither is not a browser acting for another site (curl, a script), and it
 * shows its text only to whoever sent it.
 */
function fromAnotherSite(array $headers): bool
{
    $site = $headers['sec-fetch-site'] ?? null;
    if ($site !== null) return $site !== 'same-origin' && $site !== 'none';
    $origin = $headers['origin'] ?? null;
    if ($origin === null) return false;
    $parts = parse_url($origin);
    if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) return true;
    $host = $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    return strtolower($host) !== strtolower($headers['host'] ?? '');
}

function text(int $status, string $body, array $extra = []): array
{
    return [$status, ['Content-Type' => 'text/plain; charset=utf-8', 'Cache-Control' => 'no-store'] + $extra, "$body\n"];
}

function html(int $status, string $body, string $cache): array
{
    return [$status, ['Content-Type' => 'text/html; charset=utf-8', 'Cache-Control' => $cache], $body];
}

function e(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

/** Lines of text, each escaped, joined by line breaks. */
function lines(string $text): string
{
    return implode('<br />', array_map(e(...), explode("\n", $text)));
}

/** The page shell from page.html around $main. strtr replaces in one pass, so a placeholder inside $main stays text. */
function page(string $title, string $view, string $main): string
{
    return strtr(file_get_contents(__DIR__ . '/page.html'), [
        '{{title}}' => e($title),
        '{{view}}' => $view,
        '{{main}}' => $main,
    ]);
}

function formView(array $values, array $errors): string
{
    $invalid = fn (string $key) => isset($errors[$key]) ? ' aria-invalid="true"' : '';
    $input = fn (string $key, string $label, int $max, string $extra = '') => sprintf(
        '<label>%s <input name="%s" value="%s" maxlength="%d"%s%s /></label>',
        e($label), e($key), e($values[$key]), $max, $extra, $invalid($key),
    );
    $select = function (string $name, string $label, array $options, string $chosen, string $key) use ($invalid): string {
        $html = '';
        foreach ($options as $value => $text) {
            $html .= sprintf('<option value="%s"%s>%s</option>', e((string) $value), (string) $value === $chosen ? ' selected' : '', e($text));
        }
        return sprintf('<label>%s <select name="%s"%s>%s</select></label>', e($label), e($name), $invalid($key), $html);
    };

    $messages = '';
    if ($errors !== []) {
        $messages = '<div class="card errors" role="alert"><h2>The invoice was not made</h2><ul>'
            . implode('', array_map(fn ($m) => '<li>' . e($m) . '</li>', $errors)) . '</ul></div>';
    }

    $parties = '';
    foreach (PARTIES as $party => $partyLabel) {
        $parties .= sprintf(
            '<fieldset class="card"><legend>%s</legend>%s<label>Address <textarea name="%s" rows="3" maxlength="%d"%s>%s</textarea></label>%s</fieldset>',
            e($partyLabel),
            $input("{$party}_name", 'Name', MAX_TEXT, ' required'),
            e("{$party}_address"), MAX_ADDRESS, $invalid("{$party}_address"), e($values["{$party}_address"]),
            $input("{$party}_tax_id", 'VAT number (optional)', MAX_TAX_ID),
        );
    }

    $rates = array_combine(VAT_RATES, array_map(fn ($r) => "$r %", VAT_RATES));
    $rows = '';
    foreach ($values['lines'] as $i => $line) {
        $key = fn ($field) => "lines.$i.$field";
        $rows .= sprintf(
            '<li class="line"><label class="description">Description <input name="lines[%1$d][description]" value="%2$s" maxlength="%3$d"%4$s /></label>'
            . '<label>Quantity <input name="lines[%1$d][quantity]" value="%5$s" inputmode="decimal" maxlength="12"%6$s /></label>'
            . '<label>Unit price <input name="lines[%1$d][price]" value="%7$s" inputmode="decimal" maxlength="14"%8$s /></label>%9$s</li>',
            $i, e($line['description']), MAX_TEXT, $invalid($key('description')),
            e($line['quantity']), $invalid($key('quantity')),
            e($line['price']), $invalid($key('price')),
            $select("lines[$i][vat]", 'VAT', $rates, $line['vat'], $key('vat')),
        );
    }

    return $messages . '<form method="post" action="/invoice" class="invoice-form">'
        . '<fieldset class="card"><legend>Invoice</legend>'
        . $input('number', 'Number', MAX_NUMBER, ' required')
        . $input('issued', 'Date of issue', 10, ' type="date" required')
        . $input('due', 'Due date', 10, ' type="date" required')
        . $select('currency', 'Currency', array_combine(CURRENCIES, CURRENCIES), $values['currency'], 'currency')
        . '</fieldset>'
        . $parties
        . sprintf('<fieldset class="card"><legend>Lines</legend><p class="hint">Up to %d. A line left empty is left out. Quantities take up to three decimals, prices two; a comma works as the decimal point too.</p><ol class="lines">%s</ol></fieldset>', MAX_LINES, $rows)
        . '<p><button type="submit">Make the invoice</button></p>'
        . '</form>';
}

function invoiceView(array $invoice, array $values): string
{
    $currency = e($invoice['currency']);
    $money = fn (int $minor) => e(formatMoney($minor)) . " $currency";
    $party = fn (string $label, array $p) => sprintf(
        '<section class="party"><h2>%s</h2><p><strong>%s</strong>%s%s</p></section>',
        e($label), e($p['name']),
        $p['address'] === '' ? '' : '<br />' . lines($p['address']),
        $p['tax_id'] === '' ? '' : '<br />VAT number ' . e($p['tax_id']),
    );

    $rows = '';
    foreach ($invoice['sums']['lines'] as $line) {
        $rows .= sprintf(
            '<tr><td>%s</td><td class="num">%s</td><td class="num">%s</td><td class="num">%d %%</td><td class="num">%s</td></tr>',
            e($line['description']), e(formatQuantity($line['milli'])), $money($line['minor']), $line['vat'], $money($line['total']),
        );
    }
    $rates = '';
    foreach ($invoice['sums']['rates'] as $rate) {
        $rates .= sprintf(
            '<tr><td class="num">%d %%</td><td class="num">%s</td><td class="num">%s</td><td class="num">%s</td></tr>',
            $rate['rate'], $money($rate['base']), $money($rate['vat']), $money($rate['total']),
        );
    }

    // The same values, posted back with `edit`, bring the form back filled in:
    // the server keeps nothing between two requests to do it with.
    $hidden = '';
    foreach ($values as $key => $value) {
        if ($key !== 'lines') {
            $hidden .= sprintf('<input type="hidden" name="%s" value="%s" />', e($key), e($value));
            continue;
        }
        foreach ($value as $i => $line) {
            foreach ($line as $field => $v) {
                $hidden .= sprintf('<input type="hidden" name="lines[%d][%s]" value="%s" />', $i, e($field), e($v));
            }
        }
    }

    $sample = e(SAMPLE);
    $number = e($invoice['number']);
    $issued = e($invoice['issued']);
    $due = e($invoice['due']);
    $seller = $party('Seller', $invoice['seller']);
    $buyer = $party('Buyer', $invoice['buyer']);
    $net = $money($invoice['sums']['net']);
    $vat = $money($invoice['sums']['vat']);
    $total = $money($invoice['sums']['total']);
    return <<<HTML
        <div class="toolbar screen-only">
          <p>To keep it, print it, or choose <strong>Save as PDF</strong> in your browser's print dialog
            (Ctrl+P, or ⌘P on a Mac). This page is not kept anywhere: once you leave it, it is gone.</p>
          <form method="post" action="/invoice">{$hidden}<input type="hidden" name="edit" value="1" /><button type="submit">Change something</button> <a href="/">Start over</a></form>
        </div>
        <article class="invoice">
          <p class="sample">{$sample}</p>
          <p class="watermark" aria-hidden="true">SAMPLE</p>
          <header class="invoice-head">
            <h2>Invoice <span class="number">{$number}</span></h2>
            <dl>
              <div><dt>Date of issue</dt><dd>{$issued}</dd></div>
              <div><dt>Due date</dt><dd>{$due}</dd></div>
            </dl>
          </header>
          <div class="parties">{$seller}{$buyer}</div>
          <table class="lines-table">
            <thead><tr><th>Description</th><th class="num">Quantity</th><th class="num">Unit price</th><th class="num">VAT</th><th class="num">Total excl. VAT</th></tr></thead>
            <tbody>{$rows}</tbody>
          </table>
          <table class="vat-table">
            <thead><tr><th class="num">VAT rate</th><th class="num">Base</th><th class="num">VAT</th><th class="num">Total</th></tr></thead>
            <tbody>{$rates}</tbody>
          </table>
          <dl class="totals">
            <div><dt>Total excl. VAT</dt><dd>{$net}</dd></div>
            <div><dt>VAT</dt><dd>{$vat}</dd></div>
            <div class="due"><dt>Total due</dt><dd>{$total}</dd></div>
          </dl>
          <p class="sample sample-foot">{$sample}</p>
        </article>
        HTML;
}
