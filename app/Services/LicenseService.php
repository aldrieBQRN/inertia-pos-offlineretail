<?php

namespace App\Services;

use App\Models\License;
use Carbon\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Str;

class LicenseService
{
    public function __construct(
        protected MachineIdService $machineIdService
    ) {}

    /**
     * Determine if this POS installation has an active, valid license bound to this machine.
     */
    public function isActivated(): bool
    {
        try {
            $license = $this->getActiveLicense();
            return $license !== null && $license->isValidNow();
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Retrieve the current active license for this machine.
     */
    public function getActiveLicense(): ?License
    {
        $currentMachineId = $this->machineIdService->getMachineId();

        $license = License::where('machine_id', $currentMachineId)
            ->where('is_active', true)
            ->latest('id')
            ->first();

        if (!$license) {
            return null;
        }

        // Re-verify the stored license signature and machine binding
        $validation = $this->validateToken($license->token, $currentMachineId);
        if (!$validation['valid']) {
            $license->update(['is_active' => false]);
            return null;
        }

        return $license;
    }

    /**
     * Activates a license token for this machine.
     * Throws an exception or returns validation errors if invalid.
     */
    public function activate(string $token): License
    {
        $currentMachineId = $this->machineIdService->getMachineId();
        $validation = $this->validateToken($token, $currentMachineId);

        if (!$validation['valid']) {
            throw new \InvalidArgumentException($validation['error']);
        }

        $payload = $validation['payload'];
        $signature = $validation['signature'];

        // Deactivate previous licenses on this machine
        License::where('machine_id', $currentMachineId)->update(['is_active' => false]);

        return License::create([
            'license_id' => $payload['license_id'],
            'product' => $payload['product'],
            'machine_id' => $payload['machine_id'],
            'license_type' => $payload['license_type'] ?? 'perpetual',
            'token' => trim($token),
            'signature' => $signature,
            'payload' => $payload,
            'issued_at' => Carbon::parse($payload['issued_at']),
            'expires_at' => !empty($payload['expires_at']) ? Carbon::parse($payload['expires_at']) : null,
            'activated_at' => Carbon::now(),
            'is_active' => true,
        ]);
    }

    /**
     * Deactivates the current machine's license (primarily for development/testing).
     */
    public function deactivate(): void
    {
        $currentMachineId = $this->machineIdService->getMachineId();
        License::where('machine_id', $currentMachineId)->update(['is_active' => false]);
    }

    /**
     * Validates a license token.
     * 
     * Returns array ['valid' => bool, 'error' => ?string, 'payload' => ?array, 'signature' => ?string]
     */
    public function validateToken(string $token, ?string $expectedMachineId = null): array
    {
        $token = trim($token);
        if (empty($token)) {
            return ['valid' => false, 'error' => 'License key cannot be empty.'];
        }

        $parts = explode('.', $token);
        if (count($parts) !== 2) {
            return ['valid' => false, 'error' => 'Malformed license key format.'];
        }

        [$encodedPayload, $encodedSignature] = $parts;

        $rawPayload = $this->base64UrlDecode($encodedPayload);
        $signature = $this->base64UrlDecode($encodedSignature);

        if ($rawPayload === false || $signature === false) {
            return ['valid' => false, 'error' => 'License key data is corrupted.'];
        }

        $payload = json_decode($rawPayload, true);
        if (!is_array($payload)) {
            return ['valid' => false, 'error' => 'License payload is corrupted.'];
        }

        // Required payload fields
        foreach (['license_id', 'product', 'machine_id', 'issued_at'] as $field) {
            if (empty($payload[$field])) {
                return ['valid' => false, 'error' => 'License is missing required parameters.'];
            }
        }

        // 1. Verify Asymmetric Ed25519 signature
        if (!$this->verifySignature($rawPayload, $signature)) {
            return ['valid' => false, 'error' => 'Invalid license signature.'];
        }

        // 2. Validate Product
        $expectedProduct = Config::get('license.product', 'inertia-pos');
        if ($payload['product'] !== $expectedProduct) {
            return ['valid' => false, 'error' => 'License is for another product.'];
        }

        // 3. Validate Machine ID
        $targetMachineId = $expectedMachineId ?? $this->machineIdService->getMachineId();
        if (MachineIdService::normalize($payload['machine_id']) !== MachineIdService::normalize($targetMachineId)) {
            return ['valid' => false, 'error' => 'License does not belong to this machine.'];
        }

        // 4. Validate Expiration
        if (!empty($payload['expires_at'])) {
            try {
                $expiresAt = Carbon::parse($payload['expires_at']);
                if ($expiresAt->isPast()) {
                    return ['valid' => false, 'error' => 'License has expired.'];
                }
            } catch (\Throwable $e) {
                return ['valid' => false, 'error' => 'Invalid license expiration date.'];
            }
        }

        return [
            'valid' => true,
            'error' => null,
            'payload' => $payload,
            'signature' => bin2hex($signature),
        ];
    }

    /**
     * Verify an Ed25519 signature against the public key configured in the POS.
     */
    public function verifySignature(string $rawPayload, string $signature): bool
    {
        $publicKeyHex = Config::get('license.public_key');
        if (empty($publicKeyHex)) {
            return false;
        }

        if (strlen($signature) !== SODIUM_CRYPTO_SIGN_BYTES) {
            return false;
        }

        try {
            $publicKey = sodium_hex2bin($publicKeyHex);
            if (strlen($publicKey) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
                return false;
            }

            return sodium_crypto_sign_verify_detached($signature, $rawPayload, $publicKey);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Base64URL decode helper.
     */
    public function base64UrlDecode(string $data): string|false
    {
        $remainder = strlen($data) % 4;
        if ($remainder) {
            $padlen = 4 - $remainder;
            $data .= str_repeat('=', $padlen);
        }
        return base64_decode(strtr($data, '-_', '+/'));
    }

    /**
     * Base64URL encode helper.
     */
    public static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
