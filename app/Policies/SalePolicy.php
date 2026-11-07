<?php

namespace App\Policies;

use App\Models\User;
use App\Models\Sale;

class SalePolicy
{
    /**
     * Determine if the user can view any sales.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Determine if the user can view a sale.
     */
    public function view(User $user, Sale $sale): bool
    {
        return $user->store_id === $sale->store_id;
    }

    /**
     * Determine if the user can create a sale (POS checkout).
     */
    public function create(User $user): bool
    {
        // Both admins and cashiers can create sales
        return true;
    }

    /**
     * Determine if the user can update a sale.
     */
    public function update(User $user, Sale $sale): bool
    {
        // Only admins from the same store can update sales
        return $user->is_admin && $user->store_id === $sale->store_id;
    }

    /**
     * Determine if the user can delete a sale (void/cancel).
     */
    public function delete(User $user, Sale $sale): bool
    {
        // Only admins from the same store can delete sales
        return $user->is_admin && $user->store_id === $sale->store_id;
    }

    /**
     * Determine if the user can view sale details (receipt, payment info).
     */
    public function viewDetails(User $user, Sale $sale): bool
    {
        // Only staff from the same store can view sale details
        return $user->store_id === $sale->store_id;
    }

    /**
     * Determine if the user can approve/process a sale payment.
     */
    public function approvePayment(User $user, Sale $sale): bool
    {
        // Only admins from the same store can approve payments
        return $user->is_admin && $user->store_id === $sale->store_id;
    }
}
