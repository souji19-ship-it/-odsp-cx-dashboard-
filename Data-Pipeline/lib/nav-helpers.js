'use strict';

/**
 * nav-helpers.js
 *
 * Shared Playwright navigation utilities used by multiple scrapers.
 */

const ESCAPE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Attempts to find and click a dashboard tab by its visible label using
 * multiple fallback strategies.
 *
 * @param {import('playwright').Page} page
 * @param {string} tabText - The visible label of the tab to click.
 */
async function findAndClickTab(page, tabText) {
  // Strategy 1: ARIA role="tab" exact-ish match
  try {
    await page.getByRole('tab', { name: new RegExp(ESCAPE(tabText), 'i') })
      .first().click({ timeout: 15000, force: true });
    return;
  } catch {}

  // Strategy 2: truncated label (drop last word) — handles "Automations WIP" etc.
  const withoutLast = tabText.split(' ').slice(0, -1).join(' ');
  if (withoutLast) {
    try {
      await page.getByRole('tab', { name: new RegExp(ESCAPE(withoutLast), 'i') })
        .first().click({ timeout: 10000, force: true });
      return;
    } catch {}
  }

  // Strategy 3: any visible text node
  try {
    await page.getByText(tabText, { exact: false }).first().click({ timeout: 10000, force: true });
    return;
  } catch {}

  // Diagnostic — show what tabs are visible
  const available = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"]'))
      .map(t => t.textContent?.trim()).filter(Boolean)
  ).catch(() => []);
  if (available.length) console.log(`  Available tabs: ${available.join(' | ')}`);

  throw new Error(`Could not find tab: "${tabText}"`);
}

module.exports = { findAndClickTab };
