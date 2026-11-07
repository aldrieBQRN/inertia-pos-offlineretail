<?php

use Illuminate\Support\Facades\Schedule;

// Keep the local activity log from growing without bound (runs when the scheduler is active)
Schedule::command('activity-logs:prune')->daily();
