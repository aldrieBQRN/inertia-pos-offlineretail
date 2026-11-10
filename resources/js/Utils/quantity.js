/**
 * Quantity helpers shared by the POS and Inventory screens.
 *
 * Stock is stored exactly on the server (8 decimals). These helpers only control
 * how quantities are shown and what a cashier may type, per product:
 *   - Standard products: whole numbers.
 *   - Multiple UOM: the product's "quantity decimals" (piece -> 0, meter -> 2, kg -> 3 by default).
 * Keep defaultQuantityDecimals() in sync with Product::defaultQuantityDecimals() (PHP).
 */

const WHOLE_UNITS = new Set(['pc', 'pcs', 'piece', 'pieces', 'unit', 'units', 'each', 'ea', 'box', 'boxes', 'pack', 'packs', 'pk',
    'bottle', 'bottles', 'can', 'cans', 'sachet', 'sachets', 'roll', 'rolls', 'set', 'sets', 'pair', 'pairs',
    'dozen', 'tray', 'trays', 'sack', 'sacks', 'bag', 'bags', 'g', 'gram', 'grams', 'gm', 'ml', 'milliliter',
    'milliliters', 'mm', 'millimeter', 'millimeters', 'tablet', 'tablets', 'capsule', 'capsules', 'stick', 'sticks']);
const THREE_DECIMAL_UNITS = new Set(['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'l', 'liter', 'liters', 'litre', 'litres',
    'lb', 'lbs', 'pound', 'pounds', 'gal', 'gallon', 'gallons', 'ton', 'tons', 'oz', 'ounce', 'ounces']);

/** Default decimals for a base unit name (piece -> 0, meter -> 2, kg -> 3, others -> 2). */
export const defaultQuantityDecimals = (unit) => {
    const u = String(unit ?? '').trim().toLowerCase().replace(/\.+$/, '');
    if (WHOLE_UNITS.has(u)) return 0;
    if (THREE_DECIMAL_UNITS.has(u)) return 3;
    return 2;
};

export const isMultiUom = (product) => product?.selling_method === 'multiple' || !!product?.is_multi_unit;

/** Max decimal places for this product's quantities. */
export const productQtyDecimals = (product) => {
    if (!isMultiUom(product)) return 0;
    const saved = product?.quantity_precision ?? product?.quantity_decimals;
    if (saved !== null && saved !== undefined && saved !== '' && Number.isFinite(Number(saved))) {
        return Math.max(0, Math.min(4, Number(saved)));
    }
    return defaultQuantityDecimals(product?.base_unit);
};

/** Removes floating-point noise (e.g. 99.30000000000001 -> 99.3). */
export const roundQty = (n, decimals = 8) => {
    const f = 10 ** decimals;
    return Math.round((Number(n) || 0) * f) / f;
};

/** "1,234.5" - up to `decimals` places, trailing zeros dropped. */
export const formatQty = (n, decimals = 4) =>
    roundQty(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });

/** Quantity formatted with the product's precision. */
export const formatProductQty = (product, n) => formatQty(n, productQtyDecimals(product));

/** Base unit label for stock: "Meter" for Multiple UOM, "units" for standard. */
export const stockUnitLabel = (product) => (isMultiUom(product) && product?.base_unit ? product.base_unit : 'units');

/** Number of decimal places typed, e.g. "2.50" -> 2, "3" -> 0. */
export const typedDecimals = (value) => {
    const s = String(value ?? '').trim();
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
};

/**
 * Warning for conversion factors that are repeating decimals (e.g. 0.33333333 = 1/3).
 * They cannot be stored exactly, so stock drifts slightly with every sale.
 * Returns a message, or null when the factor is exact (0.5, 0.3048, 12, ...).
 */
export const repeatingFactorHint = (factor, baseUnit, unitName) => {
    const f = Number(factor);
    if (!(f > 0) || typedDecimals(String(factor ?? '')) < 5) return null; // short decimals are exact
    for (let k = 2; k <= 1000; k++) {
        const m = Math.round(f * k);
        if (m > 0 && Math.abs(f * k - m) < 1e-6) {
            let d = k;
            while (d % 2 === 0) d /= 2;
            while (d % 5 === 0) d /= 5;
            if (d === 1) return null; // terminating decimal: exact
            const base = baseUnit || 'the base unit';
            return m === 1
                ? `${f} is a repeating decimal (1/${k}), so stock will be slightly off. Use "${unitName || 'this unit'}" as the base unit instead, then ${base} = ${k}.`
                : `${f} is a repeating decimal (${m}/${k}), so stock will be slightly off. Use a smaller base unit so every conversion factor is a whole number or exact decimal.`;
        }
    }
    return null;
};

/** HTML input step for the product (1, 0.1, 0.01, ...). */
export const qtyInputStep = (product) => {
    const d = productQtyDecimals(product);
    return d === 0 ? '1' : (1 / 10 ** d).toFixed(d);
};

/** Largest value <= n with at most `decimals` places (e.g. 0.3249 -> 0.32). */
export const floorToDecimals = (n, decimals) => {
    const f = 10 ** decimals;
    return Math.floor(roundQty(n) * f + 1e-9) / f;
};

/** Line amount in centavos, rounded per line exactly like the server (price x quantity, half up). */
export const lineAmount = (item) => Math.round(roundQty((Number(item?.price) || 0) * (Number(item?.quantity) || 0), 6));

/** Base-unit quantity of this product already in the cart (all units), optionally excluding one line. */
export const reservedBaseQty = (cart, productId, excludeLine = null) => roundQty(
    (cart || [])
        .filter(item => item.id === productId && item !== excludeLine)
        .reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.conversion_factor) || 1), 0)
);

/** Stock left after what is already in the cart, in base units. */
export const remainingBaseStock = (product, cart, excludeLine = null) =>
    roundQty((Number(product?.stock_quantity) || 0) - reservedBaseQty(cart, product?.id, excludeLine));
