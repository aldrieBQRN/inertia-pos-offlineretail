<?php

namespace App\Support;

/**
 * Fixed-point quantity helpers.
 *
 * Inventory quantities and conversion factors are stored with 8 decimal
 * places. All arithmetic goes through bcmath so stock levels never suffer
 * from binary floating-point drift.
 */
class Quantity
{
    public const SCALE = 8;

    public static function normalize($value): string
    {
        if ($value === null || $value === '') {
            return '0';
        }

        $value = trim((string) $value);

        if (!is_numeric($value)) {
            return '0';
        }

        return self::trim(bcadd($value, '0', self::SCALE));
    }

    public static function add($a, $b): string
    {
        return self::trim(bcadd(self::normalize($a), self::normalize($b), self::SCALE));
    }

    public static function subtract($a, $b): string
    {
        return self::trim(bcsub(self::normalize($a), self::normalize($b), self::SCALE));
    }

    public static function multiply($a, $b): string
    {
        return self::trim(bcmul(self::normalize($a), self::normalize($b), self::SCALE));
    }

    public static function divide($a, $b): string
    {
        $divisor = self::normalize($b);

        if (bccomp($divisor, '0', self::SCALE) === 0) {
            return '0';
        }

        return self::trim(bcdiv(self::normalize($a), $divisor, self::SCALE));
    }

    public static function compare($a, $b): int
    {
        return bccomp(self::normalize($a), self::normalize($b), self::SCALE);
    }

    public static function isWhole($value): bool
    {
        $normalized = self::normalize($value);

        return bccomp($normalized, bcadd($normalized, '0', 0), self::SCALE) === 0;
    }

    /**
     * Round a non-negative decimal to the nearest integer (cents).
     */
    public static function toInt($value): int
    {
        return (int) bcadd(self::normalize($value), '0.5', 0);
    }

    /**
     * Return an int for whole values and a float for fractional values so the
     * JSON contract stays friendly for both standard and decimal products.
     *
     * @return int|float
     */
    public static function toNumber($value)
    {
        $normalized = self::normalize($value);

        return self::isWhole($normalized) ? (int) $normalized : (float) $normalized;
    }

    public static function format($value): string
    {
        return self::trim(self::normalize($value));
    }

    /** Number of significant decimal places, e.g. "2.50" -> 1, "3" -> 0, "0.3048" -> 4. */
    public static function decimalPlaces($value): int
    {
        $formatted = self::format($value);
        $dot = strpos($formatted, '.');

        return $dot === false ? 0 : strlen($formatted) - $dot - 1;
    }

    protected static function trim(string $value): string
    {
        if (!str_contains($value, '.')) {
            return $value === '' ? '0' : $value;
        }

        $value = rtrim(rtrim($value, '0'), '.');

        return $value === '' || $value === '-' ? '0' : $value;
    }
}
