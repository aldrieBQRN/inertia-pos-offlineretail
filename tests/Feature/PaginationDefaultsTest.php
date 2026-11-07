<?php

/**
 * Pagination defaults for the standalone POS tables.
 *
 * Table pagination is client-side (slice of loaded rows), so the defaults live
 * in the page components. These tests pin the required default page sizes and
 * the per-tab pagination state used by the Audit & Reports Center.
 */

function pageSource(string $file): string
{
    return file_get_contents(resource_path("js/Pages/{$file}"));
}

test('system activity logs displays a maximum of 10 records per page', function () {
    expect(pageSource('ActivityLogs.jsx'))->toMatch('/const itemsPerPage = 10;/');
});

test('inventory management table displays a maximum of 10 records per page', function () {
    $source = pageSource('Inventory.jsx');
    expect($source)->toContain('return 10;');
    expect($source)->toContain('filteredProducts.slice((currentPage - 1) * itemsPerPage');
});

test('sales and transactions table displays a maximum of 10 records per page', function () {
    $source = pageSource('Transactions.jsx');
    expect($source)->toContain('return 10;');
    expect($source)->toContain('filteredTransactions.slice((currentPage - 1) * itemsPerPage');
});

test('shift accountability and history table displays a maximum of 10 records per page', function () {
    $source = pageSource('ShiftHistory.jsx');
    expect($source)->toContain('return 10;');
    expect($source)->toContain('filteredShifts.slice((currentPage - 1) * itemsPerPage');
});

test('audit and reports center shows a maximum of 5 records per page', function () {
    $source = pageSource('Reports.jsx');
    expect($source)->toContain('const itemsPerPage = 5;');
    expect($source)->toContain('currentDataset.slice(start, start + itemsPerPage)');
});

test('audit and reports center keeps independent pagination state per tab', function () {
    $source = pageSource('Reports.jsx');
    expect($source)->toContain('pagesByTab');
    expect($source)->toContain('pagesByTab[activeTab]');
    // Tab switches must not reset another tab's page
    expect($source)->not->toMatch('/handleTabChange = \(tabKey\) => \{\s*setActiveTab\(tabKey\);\s*setCurrentPage\(1\);/');
});

test('the relevant pages still render for the admin', function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);

    $this->withoutVite()->get('/activity-logs')->assertOk();
    $this->withoutVite()->get('/inventory')->assertOk();
    $this->withoutVite()->get('/transactions')->assertOk();
    $this->withoutVite()->get('/shifts')->assertOk();
    $this->withoutVite()->get('/reports')->assertOk();
});
