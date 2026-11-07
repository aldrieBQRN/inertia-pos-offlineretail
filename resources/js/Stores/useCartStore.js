import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

            addToCart: (product, quantity = 1, priceOverride = null) => {
                const { cart } = get();
                const isCustom = product.id === null || product.is_custom === true;
                // Custom items use a unique key (custom_key) so each entry is independent
                const existingItem = isCustom
                    ? null
                    : cart.find(item => item.id === product.id);
                const appliedPrice = priceOverride !== null ? priceOverride : product.price;

                if (!isCustom && existingItem) {
                    const newQty = existingItem.quantity + quantity;
                    if (newQty > product.stock_quantity) {
                        const allowedQty = product.stock_quantity - existingItem.quantity;
                        if (allowedQty <= 0) return;
                        set({
                            cart: cart.map(item => item.id === product.id
                                ? { ...item, price: appliedPrice, quantity: product.stock_quantity }
                                : item)
                        });
                        return;
                    }
                    set({
                        cart: cart.map(item => item.id === product.id
                            ? { ...item, price: appliedPrice, quantity: newQty }
                            : item)
                    });
                } else if (!isCustom) {
                    const finalQty = Math.min(quantity, product.stock_quantity);
                    if (finalQty < 1) return;
                    set({ cart: [...cart, { ...product, price: appliedPrice, quantity: finalQty }] });
                } else {
                    // Custom (by-weight) item: always push as a new independent line
                    set({ cart: [...cart, { ...product, price: appliedPrice, quantity }] });
                }
            },

            removeFromCart: (productId) => {
                const { cart } = get();
                const existingItem = cart.find(item => item.id === productId);
                if (!existingItem) return;
                if (existingItem.quantity > 1) {
                    set({ cart: cart.map(item => item.id === productId ? { ...item, quantity: item.quantity - 1 } : item) });
                } else {
                    set({ cart: cart.filter(item => item.id !== productId) });
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
                const subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
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