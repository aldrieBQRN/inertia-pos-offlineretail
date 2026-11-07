<?php

namespace App\Console\Commands;

use App\Models\ActivityLog;
use Illuminate\Console\Command;

class PruneActivityLogs extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = 'activity-logs:prune {--days= : Override retention days for this run}';

    /**
     * The console command description.
     */
    protected $description = 'Delete activity logs older than the configured retention period';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $days = (int) ($this->option('days') ?: config('audit.retention_days', 90));
        $cutoff = now()->subDays($days);

        $deleted = ActivityLog::where('created_at', '<', $cutoff)->delete();

        $this->info("Deleted {$deleted} activity log(s) older than {$days} day(s).");

        return self::SUCCESS;
    }
}
