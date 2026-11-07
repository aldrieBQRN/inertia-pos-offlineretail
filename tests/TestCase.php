<?php

namespace Tests;

use App\Support\CurrentStore;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        // A cached config ignores phpunit.xml and would point RefreshDatabase at the
        // real POS database (database/database.sqlite). Refuse to run in that state.
        if (file_exists(dirname(__DIR__) . '/bootstrap/cache/config.php')) {
            throw new RuntimeException('Config is cached (pos:install / optimize). Run "php artisan config:clear" before running tests so the real POS database is never touched.');
        }

        parent::setUp();

        // Each test starts from its own database state
        CurrentStore::forget();
    }
}
