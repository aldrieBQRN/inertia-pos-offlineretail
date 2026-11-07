import React from 'react';
import useCartStore from '@/Stores/useCartStore';

/**
 * ProductGrid Component
 * * Renders a responsive grid of product cards for the POS interface.
 * * Handles out-of-stock states, inventory badges, and direct cart integration.
 */
export default function ProductGrid({ products }) {
    const addToCart = useCartStore((state) => state.addToCart);

    // Render an empty state if no products match the current filters or search
    if (!products || products.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <p className="font-bold text-sm">No products found.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pb-20">
            {products.map((product) => {
                // Determine stock status for UI presentation and interaction logic
                const isOutOfStock = product.stock_quantity <= 0;
                const isLowStock = product.stock_quantity > 0 && product.stock_quantity < 10;

                return (
                    <div
                        key={product.id}
                        onClick={() => !isOutOfStock && addToCart(product)}
                        className={`bg-white rounded-none shadow-sm border border-slate-200 p-4 flex flex-col h-full transition-all
                            ${isOutOfStock
                                ? 'opacity-50 cursor-not-allowed grayscale'
                                : 'cursor-pointer hover:shadow-md hover:border-[#1B3B6A] active:scale-95'
                            }`}
                    >
                        {/* Image Placeholder with Fallback SVG */}
                        <div className="h-24 bg-slate-50 rounded-none mb-3 flex items-center justify-center overflow-hidden relative border border-slate-100">
                            {product.image_path ? (
                                <img src={product.image_path} alt={product.name} className="w-full h-full object-cover" loading="lazy"/>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-slate-300">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                                </svg>
                            )}

                            {/* Stock Badge: Displays Sold Out, Low Stock (<10), or Current Quantity */}
                            <div className={`absolute top-1 right-1 px-2 py-0.5 rounded-none text-[10px] font-bold uppercase shadow-sm
                                ${isOutOfStock
                                    ? 'bg-slate-900 text-white'
                                    : (isLowStock ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-700 border border-slate-200')
                                }`}>
                                {isOutOfStock ? 'SOLD OUT' : `Qty: ${product.stock_quantity}`}
                            </div>
                        </div>

                        {/* Product Meta Information */}
                        <div className="flex-1 flex flex-col justify-between">
                            <div>
                                <h3 className="font-extrabold text-slate-900 text-sm leading-tight mb-1 line-clamp-2">
                                    {product.name}
                                </h3>
                                <p className="text-xs font-semibold text-slate-500">
                                    {product.category?.name || 'Uncategorized'}
                                </p>
                            </div>

                            {/* Pricing and Action Indicator */}
                            <div className="mt-3 flex justify-between items-center">
                                <span className="font-extrabold font-mono text-[#1B3B6A] text-base">
                                    ₱{(product.price / 100).toFixed(2)}
                                </span>

                                {/* Quick-add indicator (Hidden for OOS items) */}
                                {!isOutOfStock && (
                                    <div className="w-6 h-6 bg-slate-100 text-[#1B3B6A] rounded-none flex items-center justify-center text-lg font-extrabold shadow-sm hover:bg-[#1B3B6A] hover:text-white transition-colors">
                                        +
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}