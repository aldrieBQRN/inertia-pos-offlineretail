<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;

/**
 * Prepares (or upgrades) this standalone, offline POS installation.
 * Safe to run on every launch: it only creates what is missing and applies new migrations.
 */
class InstallStandalone extends Command
{
    protected $signature = 'pos:install {--no-cache : Skip caching config/routes/views}';

    protected $description = 'Prepare the local SQLite database and caches for the standalone offline POS';

    public function handle(): int
    {
        if (!extension_loaded('pdo_sqlite')) {
            $this->error('The PHP "pdo_sqlite" extension is not enabled. Enable extension=pdo_sqlite (and sqlite3) in php.ini.');
            return self::FAILURE;
        }

        $this->ensureEnvironmentFile();
        $this->ensureAppKey();

        // Embedded database file
        $database = config('database.connections.sqlite.database');
        if ($database !== ':memory:' && !File::exists($database)) {
            File::ensureDirectoryExists(dirname($database));
            File::put($database, '');
            $this->info("Created local database: {$database}");
        }

        // Writable runtime folders
        foreach (['app/public', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs'] as $dir) {
            File::ensureDirectoryExists(storage_path($dir));
        }

        $this->call('migrate', ['--force' => true]);

        if (!$this->option('no-cache')) {
            $this->call('optimize:clear');
            $this->call('optimize');
        }

        if (!File::exists(public_path('build/manifest.json'))) {
            $this->warn('Frontend assets are not built yet. Run "npm run build" once (requires Node.js).');
        }

        $this->info('Standalone POS is ready.');

        return self::SUCCESS;
    }

    private function ensureEnvironmentFile(): void
    {
        $env = base_path('.env');
        if (!File::exists($env) && File::exists(base_path('.env.example'))) {
            File::copy(base_path('.env.example'), $env);
            $this->info('Created .env from .env.example');
        }
    }

    private function ensureAppKey(): void
    {
        $env = base_path('.env');
        if (!File::exists($env)) {
            return;
        }

        $contents = File::get($env);
        if (preg_match('/^APP_KEY=\S+/m', $contents)) {
            return;
        }

        $key = 'base64:' . base64_encode(random_bytes(32));
        $contents = preg_match('/^APP_KEY=/m', $contents)
            ? preg_replace('/^APP_KEY=.*$/m', 'APP_KEY=' . $key, $contents)
            : "APP_KEY={$key}\n" . $contents;

        File::put($env, $contents);
        config(['app.key' => $key]);
        $this->info('Generated application key.');
    }
}
