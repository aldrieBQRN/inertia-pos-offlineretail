<?php

namespace App\Services;

use Illuminate\Support\Facades\File;

class MachineIdService
{
    private const SALT = 'inertia-pos-machine-v1';
    private const PREFIX = 'POS';

    /**
     * Cache the resolved machine ID for this request lifecycle.
     */
    private ?string $cachedMachineId = null;
    private ?string $cachedRawIdentifier = null;

    /**
     * Resolves the underlying raw machine identifier from the operating system.
     * Prefers Windows MachineGuid, falls back to BIOS UUID, then a local persistent machine file.
     */
    public function getRawIdentifier(): string
    {
        if ($this->cachedRawIdentifier !== null) {
            return $this->cachedRawIdentifier;
        }

        $raw = null;

        if (PHP_OS_FAMILY === 'Windows') {
            $raw = $this->queryWindowsRegistryMachineGuid()
                ?? $this->queryWindowsBiosUuid();
        } elseif (PHP_OS_FAMILY === 'Linux') {
            $raw = $this->queryLinuxMachineId();
        } elseif (PHP_OS_FAMILY === 'Darwin') {
            $raw = $this->queryMacPlatformUuid();
        }

        // Persistent fallback file if OS hardware query is blocked or unavailable
        if (empty($raw)) {
            $raw = $this->getPersistentFallbackIdentifier();
        }

        $this->cachedRawIdentifier = strtolower(trim($raw));
        return $this->cachedRawIdentifier;
    }

    /**
     * Returns a normalized, display-safe Machine ID suitable for license generation.
     * Format: POS-XXXX-XXXX-XXXX-XXXX
     */
    public function getMachineId(): string
    {
        if ($this->cachedMachineId !== null) {
            return $this->cachedMachineId;
        }

        $raw = $this->getRawIdentifier();
        $hash = hash_hmac('sha256', $raw, self::SALT);
        $chunk = strtoupper(substr($hash, 0, 16));

        $formatted = self::PREFIX . '-' . implode('-', str_split($chunk, 4));
        $this->cachedMachineId = $formatted;

        return $this->cachedMachineId;
    }

    /**
     * Normalizes a user-supplied Machine ID.
     */
    public static function normalize(string $id): string
    {
        return strtoupper(trim($id));
    }

    /**
     * Validates whether a given Machine ID matches the current machine.
     */
    public function matchesCurrentMachine(string $machineId): bool
    {
        return hash_equals(self::normalize($this->getMachineId()), self::normalize($machineId));
    }

    /**
     * Query Windows MachineGuid from Registry.
     */
    private function queryWindowsRegistryMachineGuid(): ?string
    {
        $output = @shell_exec('reg query "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography" /v MachineGuid 2>nul');
        if ($output && preg_match('/MachineGuid\s+REG_SZ\s+([a-f0-9\-]+)/i', $output, $matches)) {
            $guid = trim($matches[1]);
            if (!empty($guid)) {
                return $guid;
            }
        }
        return null;
    }

    /**
     * Query Windows BIOS / Motherboard UUID via PowerShell / WMIC.
     */
    private function queryWindowsBiosUuid(): ?string
    {
        $output = @shell_exec('powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID" 2>nul');
        if ($output) {
            $uuid = trim($output);
            if (!empty($uuid) && preg_match('/^[a-f0-9\-]+$/i', $uuid)) {
                return $uuid;
            }
        }
        return null;
    }

    /**
     * Query Linux /etc/machine-id.
     */
    private function queryLinuxMachineId(): ?string
    {
        foreach (['/etc/machine-id', '/var/lib/dbus/machine-id'] as $file) {
            if (File::exists($file)) {
                $id = trim(File::get($file));
                if (!empty($id)) {
                    return $id;
                }
            }
        }
        return null;
    }

    /**
     * Query macOS IOPlatformUUID.
     */
    private function queryMacPlatformUuid(): ?string
    {
        $output = @shell_exec('ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null');
        if ($output && preg_match('/"IOPlatformUUID"\s*=\s*"([^"]+)"/i', $output, $matches)) {
            return trim($matches[1]);
        }
        return null;
    }

    /**
     * Read or generate a stable local fallback machine identifier.
     */
    private function getPersistentFallbackIdentifier(): string
    {
        $path = storage_path('app/machine.id');
        if (File::exists($path)) {
            $id = trim(File::get($path));
            if (!empty($id)) {
                return $id;
            }
        }

        $newId = bin2hex(random_bytes(16));
        File::ensureDirectoryExists(dirname($path));
        File::put($path, $newId);
        return $newId;
    }
}
