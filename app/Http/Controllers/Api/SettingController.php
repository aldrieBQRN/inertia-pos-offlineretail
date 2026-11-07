<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Store;
use App\Services\ActivityService;
use App\Support\StoreLogo;
use Illuminate\Http\Request;

/**
 * Handles the retrieval and management of the local store settings.
 */
class SettingController extends Controller
{
    /**
     * Fetch the local store profile used for receipts and branding.
     */
    public function index()
    {
        $store = Store::current();

        return response()->json([
            'store_name' => $store?->name ?? config('app.name'),
            'address' => $store?->address ?? '',
            'phone' => $store?->phone ?? '',
            'logo_path' => $store?->logo_path,
            'receipt_tagline' => $store?->receipt_tagline,
            'receipt_footer' => $store?->receipt_footer,
            'receipt_paper_width' => $store?->receipt_paper_width,
        ]);
    }

    /**
     * Update store details and branding assets.
     * Supports text configuration and logo image uploads.
     */
    public function update(Request $request)
    {
        $request->validate([
            'store_name' => 'required|string|max:255',
            'address' => 'nullable|string',
            'phone' => 'nullable|string',
            'logo' => 'nullable|image|max:2048', // Max 2MB
        ]);

        $store = Store::current() ?? abort(404, 'Store has not been set up.');

        $oldValues = [
            'store_name' => $store->name,
            'address' => $store->address,
            'phone' => $store->phone,
            'logo_path' => $store->logo_path,
        ];

        $store->name = $request->store_name;
        $store->address = $request->address;
        $store->phone = $request->phone;

        // Handle Logo Upload and Cleanup (old logo is removed from this device)
        if ($request->hasFile('logo')) {
            StoreLogo::delete($store->logo_path);
            $store->logo_path = StoreLogo::store($request->file('logo'));
        }

        $store->save();

        ActivityService::log(
            'store.settings.update',
            'update',
            'Store',
            $store->id,
            "Updated store details: {$store->name}",
            $oldValues,
            [
                'store_name' => $store->name,
                'address' => $store->address,
                'phone' => $store->phone,
                'logo_path' => $store->logo_path,
            ]
        );

        return redirect()->back()->with('success', 'Store settings updated!');
    }

    /**
     * Save receipt customization settings (header tagline, footer note, and
     * paper width). Writes a System Activity Log only when at least one
     * receipt setting actually changes.
     */
    public function updateReceiptSettings(Request $request)
    {
        $request->validate([
            'receipt_tagline' => 'nullable|string|max:255',
            'receipt_footer' => 'nullable|string|max:1000',
            'receipt_paper_width' => 'nullable|string|in:58mm,80mm',
        ]);

        $store = Store::current() ?? abort(404, 'Store has not been set up.');

        $keys = ['receipt_tagline', 'receipt_footer', 'receipt_paper_width'];
        $oldValues = [];
        $newValues = [];

        foreach ($keys as $key) {
            if ($request->exists($key)) {
                $new = $request->input($key);
                $old = $store->{$key};
                $equivalent = ($new === null || $new === '') && ($old === null || $old === '');
                if (!$equivalent && $new != $old) {
                    $oldValues[$key] = $old;
                    $newValues[$key] = $new;
                    $store->{$key} = $new;
                }
            }
        }

        if (!empty($newValues)) {
            $store->save();

            ActivityService::log(
                'store.receipt_settings.update',
                'update',
                'Store',
                $store->id,
                'Updated receipt customization & layout settings',
                $oldValues,
                array_merge($newValues, ['store_id' => $store->id])
            );
        }

        if ($request->expectsJson() || $request->isJson() || $request->wantsJson()) {
            return response()->json([
                'message' => empty($newValues)
                    ? 'Receipt settings unchanged.'
                    : 'Receipt settings updated!',
                'changed' => array_keys($newValues),
                'receipt_tagline' => $store->receipt_tagline,
                'receipt_footer' => $store->receipt_footer,
                'receipt_paper_width' => $store->receipt_paper_width,
            ]);
        }

        return redirect()->back()->with('success', empty($newValues)
            ? 'Receipt settings unchanged.'
            : 'Receipt settings updated!');
    }
}
