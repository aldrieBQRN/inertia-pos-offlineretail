import { expect } from '@playwright/test';

/**
 * Simulates a device with zero internet: every request that does not go to the
 * local POS server is aborted and recorded so a test can assert none happened.
 */
export async function cutInternet(context, baseURL) {
    const localOrigin = new URL(baseURL).origin;
    const external = [];

    await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(localOrigin) || url.startsWith('data:') || url.startsWith('blob:')) {
            return route.continue();
        }
        external.push(url);
        return route.abort('internetdisconnected');
    });

    return external;
}

/** Collects uncaught page errors and failed local requests (404/500) for later assertions. */
export function watchPageHealth(page) {
    const problems = [];
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    page.on('response', (res) => {
        if (res.status() >= 500 || (res.status() === 404 && !res.url().includes('favicon'))) {
            problems.push(`${res.status()} ${res.url()}`);
        }
    });
    return problems;
}

export function expectNoExternalRequests(external) {
    expect(external, `External requests attempted:\n${external.join('\n')}`).toEqual([]);
}
