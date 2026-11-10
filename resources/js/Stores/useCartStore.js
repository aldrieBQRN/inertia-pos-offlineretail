import { create } from 'zustand';
import { productQtyDecimals, roundQty, floorToDecimals, lineAmount } from '@/Utils/quantity';
import { persist } from 'zustand/middleware';

export const cartItemKey = (item) => {
    const base = item?.is_custom ? item?.custom_key : item?.id;
    return `${base}::${item?.product_unit_id ?? 'base'}`;
};

const initialDiscount = {
    type: null, // 'senior', 'pwd', 'loyalty_5', 'loyalty_10', 'damaged_15', 'custom_percentage', 'custom_fixed'
    label: '',
    rate: null,
    amount: 0, // cents for fixed discounts
    customerName: '',
    customerIdNumber: '',
    reason: '',
};

const useCartStore = create(
    persist(
        (set, get) => ({
            cart: [],
            isSenior: false, // Legacy flag maintained for backward compatibility
            discount: { ...initialDiscount },

            addToCart: (product, quantity = 1, priceOverride = null, unit = null) => {
                const { cart } = get();
                const isCustom = product.id === null || product.is_custom === true;
                const unitId = unit?.id ?? product.product_unit_id ?? null;
                const conversionFactor = Number(unit?.conversion_factor ?? product.conversion_factor ?? 1) || 1;
                const isWholesale = !!(unit?.is_wholesale ?? product.is_wholesale);
                const appliedPrice = priceOverride !== null
                    ? priceOverride
                    : (unit?.price ?? product.price);
                const line = {
                    ...product,
                    product_unit_id: unitId,
                    unit_name: unit?.name ?? product.unit_name ?? null,
                    conversion_factor: conversionFactor,
                    is_wholesale: isWholesale,
                    price: appliedPrice,
                };
                const lineKey = cartItemKey(line);
                const stockLimit = Number(product.stock_quantity) || 0;
                const existingItem = isCustom
                    ? null
                    : cart.find(item => cartItemKey(item) === lineKey);
                const reservedBase = isCustom
                    ? 0
                    : cart
                        .filter(item => item.id === product.id)
                        .reduce((sum, item) => sum + (Number(item.quantity) * (Number(item.conversion_factor) || 1)), 0);

                if (!isCustom && existingItem) {
                    const allowedBase = Math.max(0, stockLimit - reservedBase);
                    const allowedQty = floorToDecimals(allowedBase / conversionFactor, productQtyDecimals(product));
                    if (allowedQty <= 0) return;
                    const addQty = Math.min(quantity, allowedQty);
                    set({
                        cart: cart.map(item => cartItemKey(item) === lineKey
                            ? {
                                ...item,
                                price: appliedPrice,
                                is_wholesale: isWholesale,
                                quantity: roundQty(item.quantity + addQty),
                                conversion_factor: conversionFactor,
                                unit_name: line.unit_name,
                            }
                            : item)
                    });
                } else if (!isCustom) {
                    const allowedQty = floorToDecimals(Math.max(0, stockLimit - reservedBase) / conversionFactor, productQtyDecimals(product));
                    const finalQty = roundQty(Math.min(quantity, allowedQty));
                    if (!(finalQty > 0)) return;
                    set({ cart: [...cart, { ...line, quantity: finalQty }] });
                } else {
                    // Custom (by-weight) item: always push as a new independent line
                    set({ cart: [...cart, { ...line, quantity }] });
                }
            },

            removeFromCart: (itemOrId) => {
                const { cart } = get();
                const itemKey = typeof itemOrId === 'object' && itemOrId !== null
                    ? cartItemKey(itemOrId)
                    : null;
                const existingItem = itemKey
                    ? cart.find(item => cartItemKey(item) === itemKey)
                    : cart.find(item => item.id === itemOrId);

                if (!existingItem) return;

                if (existingItem.quantity > 1) {
                    set({
                        cart: cart.map(item => cartItemKey(item) === cartItemKey(existingItem)
                            ? { ...item, quantity: roundQty(item.quantity - 1) }
                            : item)
                    });
                } else {
                    set({ cart: cart.filter(item => cartItemKey(item) !== cartItemKey(existingItem)) });
                }
            },

            clearCart: () => set({ cart: [], isSenior: false, discount: { ...initialDiscount } }),
            setCart: (newCart) => set({ cart: newCart }),

            // Apply a structured dynamic discount
            applyDiscount: (discountConfig) => {
                const isSeniorOrPwd = discountConfig?.type === 'senior' || discountConfig?.type === 'pwd';
                set({
                    discount: {
                        type: discountConfig.type || null,
                        label: discountConfig.label || '',
                        rate: discountConfig.rate !== undefined ? Number(discountConfig.rate) : null,
                        amount: discountConfig.amount !== undefined ? Math.round(Number(discountConfig.amount)) : 0,
                        customerName: discountConfig.customerName || '',
                        customerIdNumber: discountConfig.customerIdNumber || '',
                        reason: discountConfig.reason || '',
                    },
                    isSenior: isSeniorOrPwd
                });
            },

            // Remove currently applied discount
            removeDiscount: () => set({
                discount: { ...initialDiscount },
                isSenior: false
            }),

            // Quick toggle for backward compatibility
            toggleSenior: () => {
                const { discount, isSenior } = get();
                if (isSenior || discount.type === 'senior') {
                    get().removeDiscount();
                } else {
                    get().applyDiscount({
                        type: 'senior',
                        label: 'Senior Citizen (20%)',
                        rate: 20,
                        amount: 0,
                        customerName: '',
                        customerIdNumber: '',
                        reason: 'Senior Citizen Statutory Discount'
                    });
                }
            },

            // Dynamic computations accounting for percentage or fixed discounts
            getComputations: () => {
                const { cart, discount, isSenior } = get();
                const subtotal = cart.reduce((acc, item) => acc + lineAmount(item), 0);
                let discountAmount = 0;

                if (discount && discount.type === 'custom_fixed') {
                    discountAmount = Math.min(subtotal, Math.max(0, discount.amount || 0));
                } else if (discount && discount.rate !== null && discount.rate > 0) {
                    const clampedRate = Math.min(100, Math.max(0, discount.rate));
                    discountAmount = Math.round(subtotal * (clampedRate / 100));
                } else if (isSenior || (discount && discount.type === 'senior')) {
                    discountAmount = Math.round(subtotal * 0.20);
                }

                discountAmount = Math.min(subtotal, Math.max(0, discountAmount));
                const total = Math.max(0, subtotal - discountAmount);

                return {
                    subtotal: subtotal,
                    discount: discountAmount,
                    total: total,
                    discountLabel: discount.label || (isSenior ? 'Senior Discount (20%)' : null),
                    discountType: discount.type || (isSenior ? 'senior' : null),
                    discountRate: discount.rate || (isSenior ? 20 : null),
                    customerName: discount.customerName || '',
                    customerIdNumber: discount.customerIdNumber || '',
                    discountReason: discount.reason || '',
                };
            }
        }),
        { name: 'pos-cart-storage' }
    )
);

export default useCartStore;