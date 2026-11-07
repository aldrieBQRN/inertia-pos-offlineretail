<?php

namespace App\Policies;

use App\Models\User;
use App\Models\Product;

class ProductPolicy
{
    /**
     * Determine if the user can view any products.
     */
    public function viewAny(User $user): bool
    {
        // All authenticated users can view products from their store
        return true;
    }

    /**
     * Determine if the user can view a product.
     */
    public function view(User $user, Product $product): bool
    {
        // Users can only view products from their own store
        return $user->store_id === $product->store_id;
    }

    /**
     * Determine if the user can create a product.
     */
    public function create(User $user): bool
    {
        // Only admins can create products
        return $user->is_admin;
    }

    /**
     * Determine if the user can update a product.
     */
    public function update(User $user, Product $product): bool
    {
        // Only admins from the same store can update products
        return $user->is_admin && $user->store_id === $product->store_id;
    }

    /**
     * Determine if the user can delete a product.
     */
    public function delete(User $user, Product $product): bool
    {
        // Only admins from the same store can delete products
        return $user->is_admin && $user->store_id === $product->store_id;
    }

    /**
     * Determine if the user can adjust stock for a product.
     */
    public function adjustStock(User $user, Product $product): bool
    {
        // Only admins from the same store can adjust stock
        return $user->is_admin && $user->store_id === $product->store_id;
    }
}
