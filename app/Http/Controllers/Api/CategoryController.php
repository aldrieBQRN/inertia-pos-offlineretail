<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Services\ActivityService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

/**
 * Class CategoryController
 * Handles API operations for managing product categories in the POS system.
 */
class CategoryController extends Controller
{
    public function index()
    {
        return Category::orderBy('name')->get();
    }

    public function store(Request $request)
    {
        $storeId = \App\Support\CurrentStore::id() ?? (Auth::user() ? Auth::user()->store_id : null);

        // Validate with CUSTOM friendly error messages
        $request->validate([
            'name' => [
                'required',
                'string',
                'max:50',
                Rule::unique('categories', 'name')->where(function ($query) use ($storeId) {
                    return $query->where('store_id', $storeId);
                })
            ],
            'color' => 'nullable|string|max:10'
        ], [
            // This translates the scary SQL error into a friendly alert!
            'name.unique' => 'You already have a category named "' . $request->name . '". Please choose a different name.',
            'name.required' => 'Please provide a name for your new category.',
        ]);

        $category = Category::create([
            'name' => $request->name,
            'color' => $request->color ?? '#3B82F6',
            'store_id' => $storeId,
        ]);

        ActivityService::logCreate('Category', $category->id, "Created category: {$category->name}", [
            'name' => $category->name,
            'store_id' => $category->store_id,
        ]);

        return response()->json($category, 201);
    }

    public function update(Request $request, $id)
    {
        $category = Category::findOrFail($id);
        $storeId = $category->store_id ?? \App\Support\CurrentStore::id() ?? (Auth::user() ? Auth::user()->store_id : null);
        $oldValues = [
            'name' => $category->name,
            'store_id' => $storeId,
        ];

        // Validate with CUSTOM friendly error messages
        $request->validate([
            'name' => [
                'required',
                'string',
                'max:50',
                Rule::unique('categories', 'name')->where(function ($query) use ($storeId) {
                    return $query->where('store_id', $storeId);
                })->ignore($id)
            ],
            'color' => 'nullable|string|max:10'
        ], [
            // Friendly alert for updates too
            'name.unique' => 'Another category is already using the name "' . $request->name . '".',
            'name.required' => 'The category name cannot be empty.',
        ]);

        $category->update([
            'name' => $request->name,
            'color' => $request->color ?? $category->color,
        ]);

        ActivityService::logUpdate('Category', $category->id, "Updated category: {$category->name}", $oldValues, [
            'name' => $category->name,
            'store_id' => $category->store_id,
        ]);

        return response()->json($category);
    }

    public function destroy($id)
    {
        $category = Category::findOrFail($id);
        $categoryValues = [
            'name' => $category->name,
            'store_id' => $category->store_id,
        ];

        if ($category->products()->count() > 0) {
            return response()->json([
                'message' => 'Cannot delete: This category currently contains products. Please reassign those products first.'
            ], 400);
        }

        $category->delete();

        ActivityService::logDelete('Category', $id, "Deleted category: {$categoryValues['name']}", $categoryValues);

        return response()->json(['message' => 'Category deleted']);
    }
}
