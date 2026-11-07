<?php

namespace App\Http\Middleware;

use App\Models\Store;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    protected $rootView = 'app';

    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    public function share(Request $request): array
    {
        $user = $request->user();

        return [
            ...parent::share($request),

            // The single Admin account has access to every feature
            'auth' => [
                'user' => $user ? [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => 'admin',
                    'is_admin' => true,
                    'auth_type' => $user->auth_type,
                    'store_id' => $user->store_id,
                    'avatar_path' => $user->avatar_path,
                    'account_number' => $user->account_number,
                    'phone_number' => $user->phone_number,
                    'address' => $user->address,
                    'city' => $user->city,
                    'province' => $user->province,
                    'country' => $user->country,
                    'is_active' => (bool) $user->is_active,
                    'created_at' => $user->created_at,
                ] : null,
                'csrf_token' => csrf_token(),
            ],

            'flash' => [
                'success' => $request->hasSession() ? $request->session()->get('success') : null,
                'error' => $request->hasSession() ? $request->session()->get('error') : null,
            ],

            // Local store details (receipts, header, settings)
            'settings' => function () {
                $appName = config('app.name', 'Inertia POS');
                $store = Store::current();

                return [
                    'app_name'        => $appName,
                    'logo_path'       => null,
                    'store_id'        => $store?->id,
                    'store_name'      => $store?->name ?? $appName,
                    'store_logo_path' => $store?->logo_path,
                    'address'         => $store?->address ?? '',
                    'phone'           => $store?->phone ?? '',
                ];
            },
        ];
    }
}
