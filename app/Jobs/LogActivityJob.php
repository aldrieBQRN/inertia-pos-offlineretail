<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class LogActivityJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Activity data to be logged.
     */
    private array $activityData;

    /**
     * Create a new job instance.
     */
    public function __construct(array $activityData)
    {
        $this->activityData = $activityData;

        // Use a dedicated queue for logs so it doesn't block other jobs
        $this->onQueue(config('audit.queue_name', 'logs'));
    }

    /**
     * Execute the job - write the activity log to database.
     */
    public function handle(): void
    {
        ActivityLog::create($this->activityData);
    }

    /**
     * Handle a job failure.
     */
    public function failed(\Throwable $exception): void
    {
        // Log the failure but don't crash - we don't want audit logging failures
        // to break the main application
        \Illuminate\Support\Facades\Log::error('Activity logging job failed', [
            'exception' => $exception->getMessage(),
            'activity_data' => $this->activityData,
        ]);
    }
}
