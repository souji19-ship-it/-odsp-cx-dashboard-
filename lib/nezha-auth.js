'use strict';

const NEZHA_BASE = 'https://www.microsoftnezha.com';

/**
 * Quick probe: call the Superset /me/ endpoint to see if the session is live.
 * Only valid when the page is already on the Nezha domain.
 */
async function checkNezhaAuth(page) {
  const probe = await page.evaluate(async () => {
    try {
      const r = await fetch('/nezha/api/v1/me/', { credentials: 'include' });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }).catch(() => ({ ok: false }));
  return probe.ok;
}

/**
 * Ensure the browser session is authenticated with Nezha/Superset.
 *
 * Login flow observed:
 *   1. Navigate to dashboard URL
 *   2. Nezha redirects to  /login/?next=<dashboard>
 *   3. Login page has a "Sign in with Azure" / "LOGIN" provider button
 *   4. That sends us to login.microsoftonline.com
 *   5. Windows SSO / account picker
 *   6. Redirect back to Nezha with a session cookie
 *
 * @param {import('playwright').Page} page
 * @param {string} targetUrl  - The dashboard URL we ultimately want to land on.
 *                              Using the real URL lets Nezha's ?next= redirect bring
 *                              us back to exactly the right place after SSO.
 * @returns {Promise<boolean>} true if authenticated
 */
async function ensureLoggedIn(page, targetUrl) {
  const landingUrl = targetUrl || `${NEZHA_BASE}/nezha/`;

  await page.bringToFront().catch(() => {});

  // Fast path: already on Nezha and session is alive
  if (page.url().startsWith(NEZHA_BASE) && await checkNezhaAuth(page)) {
    console.log('  ✓ Nezha: session active');
    return true;
  }

  // If the page is starting from a non-Nezha origin (e.g. about:blank), navigate
  // to the Nezha base URL first. The base SPA shell loads without a dashboard-level
  // CSRF check, which puts the page on the microsoftnezha.com origin. The subsequent
  // navigation to the actual dashboard is then a same-site hop, so SameSite=Strict/Lax
  // session cookies are included and Nezha recognises the session without /login/.
  if (!page.url().startsWith(NEZHA_BASE)) {
    await page.goto(`${NEZHA_BASE}/nezha/`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500);
    if (!page.url().includes('/login/') && await checkNezhaAuth(page)) {
      // Session is live. Now navigate to the real target same-site.
      if (landingUrl !== `${NEZHA_BASE}/nezha/`) {
        await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
      if (!page.url().includes('/login/')) {
        console.log('  ✓ Nezha: authenticated (same-site nav)');
        return true;
      }
    }
  }

  // Navigate to the target dashboard — Nezha will redirect to /login/?next=... if needed
  console.log(`  → Nezha: navigating to dashboard to trigger auth...`);
  await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);

  let url = page.url();
  console.log(`  → Current URL after nav: ${url}`);

  // ── Step 1: Handle Nezha's own /login/ page ───────────────────────────────
  if (url.includes('/login/')) {
    console.log('  → Nezha login page detected — clicking SSO provider...');

    // Superset/Nezha login page typically has a button like:
    //   "Sign In With Azure AD" / "LOGIN WITH AZURE" / "Sign in with Microsoft"
    // or an <a> tag pointing to /oauth/microsoft/ or /login/azure/
    const ssoSelectors = [
      'button:has-text("Login")',         // Nezha's own "Login Required" page
      'a[href*="/oauth/"]',
      'a[href*="/login/azure"]',
      'a[href*="microsoft"]',
      'a[href*="azure"]',
      'button:has-text("Azure")',
      'button:has-text("Microsoft")',
      'button:has-text("Sign in")',
      'a:has-text("Azure")',
      'a:has-text("Microsoft")',
      'a:has-text("Sign in")',
      '.provider',                       // Flask-AppBuilder SSO provider link
      '[class*="provider"]',
    ];

    let clicked = false;
    for (const sel of ssoSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          await el.click({ force: true, timeout: 5000 });
          clicked = true;
          console.log(`  ✓ Clicked SSO button (${sel})`);
          break;
        }
      } catch {}
    }

    if (!clicked) {
      // Fallback: dump visible links to help diagnose
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a, button')).map(el => ({
          tag: el.tagName,
          text: el.textContent?.trim().slice(0, 60),
          href: el.href || null,
        })).filter(l => l.text)
      ).catch(() => []);
      console.log('  🔍 Login page elements:', JSON.stringify(links.slice(0, 10), null, 2));
      console.log('  ⚠️  Could not find SSO button — may need manual click');
      return false;
    }

    // Wait until the page actually navigates away from /login/
    try {
      await page.waitForURL(u => !u.includes('/login/'), { timeout: 30000 });
    } catch {
      // May still be in-flight; fall through and let the URL check below decide
    }
    await page.waitForTimeout(1000);
    url = page.url();
    console.log(`  → After SSO click: ${url}`);
  }

  // ── Step 2: Handle Microsoft account picker / MSAL ───────────────────────
  const onMsal = url.includes('login.microsoft') || url.includes('login.microsoftonline');
  if (onMsal) {
    console.log('  → Microsoft account picker — selecting @microsoft.com...');
    let clicked = false;

    // Look for the tile that contains the user's microsoft.com email
    try {
      const tiles = await page.locator('[data-test-id="tile"], .tile, [class*="account"]').all();
      for (const tile of tiles) {
        const text = await tile.textContent().catch(() => '');
        if (text.includes('@microsoft.com') || text.includes('microsoft.com')) {
          await tile.click({ force: true, timeout: 5000 });
          clicked = true;
          console.log('  ✓ Clicked @microsoft.com account tile');
          break;
        }
      }
    } catch {}

    if (!clicked) {
      try {
        await page.getByText('@microsoft.com').first().click({ timeout: 8000, force: true });
        clicked = true;
      } catch {}
    }

    if (!clicked) {
      try {
        await page.locator('[role="button"], .tile, [class*="account"]').first()
          .click({ timeout: 5000, force: true });
        clicked = true;
        console.log('  ✓ Clicked first account option (fallback)');
      } catch {}
    }

    if (!clicked) {
      console.log('  ⚠️  Could not find account tile — manual auth may be required');
      return false;
    }

    // Wait for MSAL to redirect back to Nezha
    console.log('  ⏳ Waiting for MSAL redirect back to Nezha...');
    try {
      await page.waitForURL(
        u => !u.includes('login.microsoft') && !u.includes('login.microsoftonline'),
        { timeout: 60000 }
      );
      console.log('  ✓ MSAL redirect complete');
    } catch {
      console.log('  ⚠️  MSAL redirect timed out — may need manual completion');
      return false;
    }
  }

  // ── Step 3: Verify we're now authenticated ────────────────────────────────
  // Give the session a moment to fully establish after the redirect
  await page.waitForTimeout(2000);
  url = page.url();

  // If we're still on a login page, auth didn't complete
  if (url.includes('/login/')) {
    console.log(`  ⚠️  Still on login page — manual auth required (${url})`);
    return false;
  }

  // If we're on the Nezha domain and not on a login page, we're in.
  // (The /me/ API probe requires CSRF headers when called via fetch and is
  //  not a reliable gate — the dashboard loading is the real proof of auth.)
  if (url.startsWith(NEZHA_BASE)) {
    console.log('  ✓ Nezha: authenticated');
    return true;
  }

  console.log(`  ⚠️  Auth unclear — unexpected URL: ${url}`);
  return false;
}

module.exports = { NEZHA_BASE, checkNezhaAuth, ensureLoggedIn };
