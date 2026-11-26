<?php

declare(strict_types=1);

// What an invoice is made of, how a posted form becomes one, and its sums.
//
// Money never touches a float. A price is read from its decimal text straight
// into whole minor units (cents, haléře), a quantity into thousandths, and
// every product, sum and percentage after that is integer arithmetic with one
// explicit rounding rule. The largest numbers the bounds allow stay far below
// PHP_INT_MAX, so nothing can overflow into a float either.

namespace CopperOwl;

const MAX_LINES = 10;
const MAX_TEXT = 120;
const MAX_ADDRESS = 240;
const MAX_ADDRESS_LINES = 4;
const MAX_NUMBER = 30;
const MAX_TAX_ID = 20;
// 99,999.999 of something at 99,999,999.99 each is 1e18 thousandths of a
// minor unit, under PHP_INT_MAX (9.2e18). The line totals that come out of it
// are a thousand times smaller, so ten of them, and their VAT, fit easily.
const MAX_QUANTITY_DIGITS = 5;
const MAX_PRICE_DIGITS = 8;

const VAT_RATES = [0, 12, 21];
const CURRENCIES = ['CZK', 'EUR', 'USD'];

/** The text fields of the form: name => [label, maximum length, multi-line]. */
const PARTY_FIELDS = [
    'name' => ['name', MAX_TEXT, false],
    'address' => ['address', MAX_ADDRESS, true],
    'tax_id' => ['VAT number', MAX_TAX_ID, false],
];
const PARTIES = ['seller' => 'Seller', 'buyer' => 'Buyer'];

/** Every field a visitor can fill in, empty, as the blank form shows it. */
function blankValues(): array
{
    $values = ['number' => '', 'issued' => '', 'due' => '', 'currency' => 'CZK'];
    foreach (array_keys(PARTIES) as $party) {
        foreach (array_keys(PARTY_FIELDS) as $field) {
            $values["{$party}_{$field}"] = '';
        }
    }
    $values['lines'] = array_fill(0, MAX_LINES, blankLine());
    return $values;
}

function blankLine(): array
{
    return ['description' => '', 'quantity' => '', 'price' => '', 'vat' => '21'];
}

/**
 * Reads a posted form. Returns [values, errors, invoice]: the values to show
 * the form again with, messages keyed by field, and the invoice when there
 * are no messages. A message never repeats what was posted, and a value that
 * broke a bound is not shown again either.
 */
function readForm(array $post): array
{
    $values = blankValues();
    $errors = [];

    // The shape first: what a browser sends from this form is strings, and
    // at most MAX_LINES lines. Anything else did not come from the form, and
    // gets the blank form back rather than a guess at what was meant.
    $lines = $post['lines'] ?? [];
    // Line keys 0 to MAX_LINES - 1 and nothing else: that bounds the count too.
    if (!is_array($lines) || array_diff(array_keys($lines), range(0, MAX_LINES - 1)) !== []) {
        return [$values, ['form' => sprintf('An invoice here has at most %d lines.', MAX_LINES)], null];
    }
    foreach (array_keys($values) as $key) {
        if ($key !== 'lines' && isset($post[$key]) && !is_string($post[$key])) {
            return [$values, ['form' => 'The form was not sent the way this page sends it.'], null];
        }
    }
    foreach ($lines as $line) {
        if (!is_array($line) || array_filter($line, fn ($v) => !is_string($v)) !== []) {
            return [$values, ['form' => 'The form was not sent the way this page sends it.'], null];
        }
    }

    $text = function (string $key, string $label, int $max, bool $multiline, bool $required) use ($post, &$values, &$errors): string {
        $value = cleanText($post[$key] ?? '', $multiline);
        if ($value === null) {
            $errors[$key] = "$label: contains characters that are not allowed here.";
            return '';
        }
        if (length($value) > $max) {
            $errors[$key] = "$label: at most $max characters.";
            return '';
        }
        if ($multiline && substr_count($value, "\n") >= MAX_ADDRESS_LINES) {
            $errors[$key] = sprintf('%s: at most %d lines.', $label, MAX_ADDRESS_LINES);
            return '';
        }
        $values[$key] = $value;
        if ($required && $value === '') $errors[$key] = "$label: required.";
        return $value;
    };

    $number = $text('number', 'Invoice number', MAX_NUMBER, false, true);
    if ($number !== '' && !preg_match('~^[A-Za-z0-9/._-]+$~', $number)) {
        $errors['number'] = 'Invoice number: letters, digits and / . _ - only.';
    }

    $parties = [];
    foreach (PARTIES as $party => $partyLabel) {
        foreach (PARTY_FIELDS as $field => [$label, $max, $multiline]) {
            $parties[$party][$field] = $text("{$party}_{$field}", "$partyLabel $label", $max, $multiline, $field === 'name');
        }
    }

    $dates = [];
    foreach (['issued' => 'Date of issue', 'due' => 'Due date'] as $key => $label) {
        $raw = $post[$key] ?? '';
        $date = parseDate($raw);
        if ($date === null) {
            $errors[$key] = "$label: a date, as YYYY-MM-DD.";
        } else {
            $values[$key] = $raw;
            $dates[$key] = $date;
        }
    }
    if (isset($dates['issued'], $dates['due']) && $dates['due'] < $dates['issued']) {
        $errors['due'] = 'Due date: not before the date of issue.';
    }

    $currency = $post['currency'] ?? '';
    if (in_array($currency, CURRENCIES, true)) {
        $values['currency'] = $currency;
    } else {
        $errors['currency'] = 'Currency: one of ' . implode(', ', CURRENCIES) . '.';
    }

    $items = [];
    foreach ($lines as $i => $line) {
        $n = $i + 1;
        $line += blankLine();
        $description = cleanText($line['description'], false);
        $quantity = trim($line['quantity']);
        $price = trim($line['price']);
        // A line left empty is not a line. The VAT rate has a default, so
        // it does not count as filled in.
        if ($description === '' && $quantity === '' && $price === '') continue;

        if ($description === null || length($description) > MAX_TEXT) {
            $errors["lines.$i.description"] = sprintf('Line %d: a description of at most %d printable characters.', $n, MAX_TEXT);
        } elseif ($description === '') {
            $errors["lines.$i.description"] = "Line $n: a description is required.";
        } else {
            $values['lines'][$i]['description'] = $description;
        }
        $milli = parseDecimal($quantity, MAX_QUANTITY_DIGITS, 3);
        if ($milli === null || $milli === 0) {
            $errors["lines.$i.quantity"] = sprintf('Line %d: a quantity above 0, up to %s, with at most three decimals.', $n, str_repeat('9', MAX_QUANTITY_DIGITS));
        } else {
            $values['lines'][$i]['quantity'] = $quantity;
        }
        $minor = parseDecimal($price, MAX_PRICE_DIGITS, 2);
        if ($minor === null) {
            $errors["lines.$i.price"] = sprintf('Line %d: a unit price of 0 or more, up to %s, with at most two decimals.', $n, str_repeat('9', MAX_PRICE_DIGITS));
        } else {
            $values['lines'][$i]['price'] = $price;
        }
        $vat = $line['vat'];
        if (!in_array($vat, array_map('strval', VAT_RATES), true)) {
            $errors["lines.$i.vat"] = "Line $n: a VAT rate from the list.";
        } else {
            $values['lines'][$i]['vat'] = $vat;
        }
        $lineErrors = array_filter(array_keys($errors), fn ($k) => str_starts_with($k, "lines.$i."));
        if ($lineErrors === []) {
            $items[] = ['description' => $description, 'milli' => $milli, 'minor' => $minor, 'vat' => (int) $vat];
        }
    }
    if ($items === [] && !array_filter(array_keys($errors), fn ($k) => str_starts_with($k, 'lines.'))) {
        $errors['lines'] = 'At least one line: a description, a quantity and a unit price.';
    }

    if ($errors !== []) return [$values, $errors, null];

    return [$values, [], [
        'number' => $number,
        'issued' => $values['issued'],
        'due' => $values['due'],
        'currency' => $values['currency'],
        'seller' => $parties['seller'],
        'buyer' => $parties['buyer'],
        'sums' => totals($items),
    ]];
}

/**
 * The sums of an invoice, all in minor units. A line is quantity times unit
 * price, rounded half up to the minor unit. VAT is worked out once per rate,
 * on the sum of the lines at that rate, and rounded half up the same way:
 * rounding every line first and adding the roundings up would let the VAT on
 * the invoice disagree with the VAT on its own subtotal.
 */
function totals(array $items): array
{
    $lines = [];
    $byRate = [];
    foreach ($items as $item) {
        $total = roundedDivide($item['milli'] * $item['minor'], 1000);
        $lines[] = $item + ['total' => $total];
        $byRate[$item['vat']] = ($byRate[$item['vat']] ?? 0) + $total;
    }
    ksort($byRate);
    $rates = [];
    $net = 0;
    $vat = 0;
    foreach ($byRate as $rate => $base) {
        $tax = roundedDivide($base * $rate, 100);
        $rates[] = ['rate' => $rate, 'base' => $base, 'vat' => $tax, 'total' => $base + $tax];
        $net += $base;
        $vat += $tax;
    }
    return ['lines' => $lines, 'rates' => $rates, 'net' => $net, 'vat' => $vat, 'total' => $net + $vat];
}

/** $a / $b for whole numbers $a >= 0 and $b > 0, rounded half up. */
function roundedDivide(int $a, int $b): int
{
    return intdiv($a + intdiv($b, 2), $b);
}

/**
 * A non-negative decimal written as text, as a whole number of
 * 10^-$decimals: "1.5" with 3 decimals is 1500. A comma is a decimal point
 * too, as it is wherever this invoice is likely to be used. Null for anything
 * else: a sign, an exponent, grouping, too many digits.
 */
function parseDecimal(string $text, int $digits, int $decimals): ?int
{
    if (!preg_match('/^(\d{1,' . $digits . '})(?:[.,](\d{1,' . $decimals . '}))?$/', $text, $m)) return null;
    return (int) $m[1] * 10 ** $decimals + (int) str_pad($m[2] ?? '', $decimals, '0');
}

/** A calendar date as YYYY-MM-DD, between 2000 and 2099, or null. */
function parseDate(mixed $text): ?string
{
    if (!is_string($text) || !preg_match('/^(20\d\d)-(\d\d)-(\d\d)$/', $text, $m)) return null;
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? $text : null;
}

/**
 * Text as it will be printed: valid UTF-8, trimmed, line breaks as "\n" when
 * $multiline, and no control or direction-override characters. The latter
 * can make a line display in an order other than the one it was typed in,
 * which on an invoice means a number that reads differently from what it is.
 * Null when anything like that is in it.
 */
function cleanText(string $text, bool $multiline): ?string
{
    if (!preg_match('//u', $text)) return null;
    $text = trim(str_replace(["\r\n", "\r"], "\n", $text));
    if ($multiline) {
        $text = implode("\n", array_map('trim', explode("\n", $text)));
        $text = preg_replace("/\n{2,}/", "\n", $text);
    }
    $forbidden = $multiline ? '/[^\P{Cc}\n]|[\x{202A}-\x{202E}\x{2066}-\x{2069}]/u' : '/\p{Cc}|[\x{202A}-\x{202E}\x{2066}-\x{2069}]/u';
    return preg_match($forbidden, $text) ? null : $text;
}

/** Length in characters, which is what a visitor counts, not bytes. */
function length(string $text): int
{
    return preg_match_all('/./su', $text);
}

/** 123456 minor units as "1,234.56". */
function formatMoney(int $minor): string
{
    return number_format(intdiv($minor, 100)) . '.' . str_pad((string) ($minor % 100), 2, '0', STR_PAD_LEFT);
}

/** 1500 thousandths as "1.5", 2000 as "2". */
function formatQuantity(int $milli): string
{
    $fraction = rtrim(str_pad((string) ($milli % 1000), 3, '0', STR_PAD_LEFT), '0');
    return number_format(intdiv($milli, 1000)) . ($fraction === '' ? '' : ".$fraction");
}
