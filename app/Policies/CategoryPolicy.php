<?php

namespace App\Policies;

use App\Models\User;
use App\Models\Category;

class CategoryPolicy
{
    /**
     * Determine if the user can view any categories.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Determine if the user can view a category.
     */
    public function view(User $user, Category $category): bool
    {
        return $user->store_id === $category->store_id;
    }

    /**
     * Determine if the user can create a category.
     */
    public function create(User $user): bool
    {
        return $user->is_admin;
    }

    /**
     * Determine if the user can update a category.
     */
    public function update(User $user, Category $category): bool
    {
        return $user->is_admin && $user->store_id === $category->store_id;
    }

    /**
     * Determine if the user can delete a category.
     */
    public function delete(User $user, Category $category): bool
    {
        return $user->is_admin && $user->store_id === $category->store_id;
    }
}
