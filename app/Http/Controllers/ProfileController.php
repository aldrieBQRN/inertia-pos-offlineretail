<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\ActivityService;
use App\Services\ImageCompressionService;
use App\Support\AdminCredential;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redirect;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Admin profile and sign-in credential management.
 */
class ProfileController extends Controller
{
    public function edit(Request $request): Response
    {
        return Inertia::render('Profile/Edit', [
            'auth_type' => $request->user()->auth_type ?? 'password',
        ]);
    }

    public function update(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name'         => ['required', 'string', 'max:255'],
            'phone_number' => ['nullable', 'string', 'max:20'],
            'address'      => ['nullable', 'string', 'max:255'],
            'city'         => ['nullable', 'string', 'max:100'],
            'province'     => ['nullable', 'string', 'max:100'],
            'country'      => ['nullable', 'string', 'max:100'],
            'avatar'       => ['nullable', 'image', 'mimes:jpeg,png,jpg,webp', 'max:2048'],
        ]);

        $user = $request->user();
        $user->fill(collect($validated)->except('avatar')->all());

        // Capture changes before save; after save getOriginal() is refreshed.
        // Never log credentials or recovery data.
        $auditable = ['name', 'phone_number', 'address', 'city', 'province', 'country'];
        $dirty = $user->getDirty();
        $oldValues = [];
        $newValues = [];

        foreach ($auditable as $field) {
            if (array_key_exists($field, $dirty)) {
                $oldValues[$field] = $user->getOriginal($field);
                $newValues[$field] = $user->{$field};
            }
        }

        $avatarChanged = $request->hasFile('avatar');
        $hadAvatar = (bool) $user->avatar_path;

        if ($request->hasFile('avatar')) {
            if ($user->avatar_path && Storage::disk('public')->exists($user->avatar_path)) {
                Storage::disk('public')->delete($user->avatar_path);
            }

            try {
                $user->avatar_path = (new ImageCompressionService())->compressAvatar($request->file('avatar'));
            } catch (\Exception $e) {
                Log::error('Avatar compression failed: ' . $e->getMessage());
                $user->avatar_path = $request->file('avatar')->store('avatars', 'public');
            }
        }

        $user->save();

        if ($avatarChanged) {
            $oldValues['avatar_path'] = $hadAvatar ? '(previous avatar)' : null;
            $newValues['avatar_path'] = '(avatar updated)';
        }

        if (!empty($newValues)) {
            ActivityService::logUpdate(
                'User',
                $user->id,
                'Updated profile',
                $oldValues,
                $newValues
            );
        }

        return Redirect::route('profile.edit')->with('status', 'profile-updated');
    }

    /**
     * Change the Admin PIN/password (and optionally switch between PIN and password).
     */
    public function updateCredential(Request $request): RedirectResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'current_credential' => ['required', 'string', 'max:128'],
            'auth_type' => ['required', Rule::in(User::AUTH_TYPES)],
        ]);

        if (!Hash::check($validated['current_credential'], $user->password)) {
            throw ValidationException::withMessages([
                'current_credential' => 'The current ' . AdminCredential::label($user->auth_type) . ' is incorrect.',
            ]);
        }

        $request->validate([
            'credential' => AdminCredential::rules($validated['auth_type']),
        ], [], ['credential' => AdminCredential::label($validated['auth_type'])]);

        $user->forceFill([
            'password' => $request->input('credential'),
            'auth_type' => $validated['auth_type'],
        ])->save();

        ActivityService::logPasswordChange($user->id);

        return Redirect::route('profile.edit')->with('status', 'credential-updated');
    }
}
