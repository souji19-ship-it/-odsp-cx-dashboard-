'use strict';

const { connectToEdge } = require('./lib/cdp-connect');

const NEZHA_URL = 'https://www.microsoftnezha.com/nezha/dashboard/a82f4c8e-6f29-4402-8fa1-c0af49a5132d/';

async function nezhaLogin() {
  console.log('Connecting to Edge via CDP...');
  const { page } = await connectToEdge();

  console.log('Navigating to Nezha dashboard...');
  await page.goto(NEZHA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const url = page.url();
  console.log(`Current URL: ${url}`);

  // Check if already logged in
  const loginRequired = await page.$('text=Login Required').catch(() => null);
  if (!loginRequired) {
    console.log('✓ Already logged in — no action needed.');
    return;
  }

  console.log('→ "Login Required" detected. Clicking Login button...');
  try {
    await page.getByRole('button', { name: /login/i }).first().click({ timeout: 10000 });
  } catch {
    await page.locator('a:has-text("Login"), button:has-text("Login")').first().click({ timeout: 10000 });
  }

  // Wait for Microsoft SSO redirect
  await page.waitForTimeout(3000);
  const postClickUrl = page.url();
  console.log(`After click URL: ${postClickUrl}`);

  if (postClickUrl.includes('login.microsoft') || postClickUrl.includes('microsoftonline')) {
    console.log('→ Microsoft SSO page detected. Attempting account selection...');
    try {
      await page.getByText('@microsoft.com').first().click({ timeout: 10000, force: true });
      console.log('  ✓ Selected @microsoft.com account');
    } catch {
      try {
        await page.locator('[data-test-id*="tile"], .account-tile, [role="button"]').first().click({ timeout: 10000, force: true });
        console.log('  ✓ Clicked first account option');
      } catch (e) {
        console.log(`  ⚠️  Could not auto-select account: ${e.message}`);
        console.log('  → Please manually select your account in the Edge window, then re-run /nezha-login or /scrape-msft-report.');
        return;
      }
    }
  }

  // Wait for redirect back to Nezha
  console.log('→ Waiting for SSO to complete...');
  try {
    await page.waitForURL(
      url => !url.includes('login.microsoft') && !url.includes('microsoftonline'),
      { timeout: 30000 }
    );
    console.log('  ✓ SSO redirect complete');
  } catch {
    console.log('  ⚠️  SSO redirect took longer than 30s — check the Edge window manually.');
    return;
  }

  await page.waitForTimeout(4000);

  // Verify dashboard loaded
  const tabs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="tab"]')).map(t => t.textContent?.trim()).filter(Boolean);
  });

  if (tabs.length > 0) {
    console.log(`\n✅ Login successful! Dashboard loaded with tabs: ${tabs.join(' | ')}`);
    console.log('\nYou can now run: node scrape-all-dashboards.js');
  } else {
    console.log('\n⚠️  Dashboard loaded but no tabs found yet — may still be loading. Try running the scraper in a few seconds.');
  }
}

nezhaLogin().catch(err => {
  console.error('❌ Login error:', err.message);
  process.exit(1);
});
