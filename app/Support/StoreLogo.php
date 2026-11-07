<?php

namespace App\Support;

use App\Services\ImageCompressionService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * Stores the store logo on this device (storage/app/public/logos), shared by
 * First-Time Setup and Store Settings. Returns the "/storage/..." path saved
 * in stores.logo_path.
 */
class StoreLogo
{
    /** Accepted logo formats for First-Time Setup (raster images only). */
    public const SETUP_RULES = ['nullable', 'file', 'image', 'mimes:jpeg,jpg,png,webp', 'max:2048'];

    public static function store(UploadedFile $file): string
    {
        try {
            // Skip compression for SVG as it is vector-based and not supported by the GD decoder
            if (strtolower($file->getClientOriginalExtension()) === 'svg' || str_contains(strtolower((string) $file->getMimeType()), 'svg')) {
                $path = $file->store('logos', 'public');
            } else {
                $path = (new ImageCompressionService())->compressLogo($file);
            }
        } catch (\Exception $e) {
            // Fallback to original upload safely
            $path = $file->store('logos', 'public');
        }

        return '/storage/' . $path;
    }

    public static function delete(?string $logoPath): void
    {
        if (!$logoPath) {
            return;
        }

        $relative = ltrim(str_replace('/storage/', '', $logoPath), '/');
        Storage::disk('public')->delete($relative);

        // ImageCompressionService also mirrors files into public/storage
        $mirror = public_path('storage/' . $relative);
        if (is_file($mirror)) {
            @unlink($mirror);
        }
    }
}
