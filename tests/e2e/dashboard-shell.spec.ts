import { test, expect, type Page } from "@playwright/test";

/**
 * Bilingual + bi-themed dashboard shell regression net.
 *
 * Phase 3 dashboard relies on RTL/LTR mirroring, light/dark theming, the
 * ⌘K command palette, and keyboard reachability of every KPI card. Any of
 * these can silently regress from a single CSS or context change. This
 * spec asserts:
 *
 *   1. Visual snapshots for the four locale × theme combinations
 *      (AR-light, AR-dark, EN-light, EN-dark) with dynamic numeric content
 *      masked so the diff catches structural / token / mirroring breakage,
 *      not transient seed data.
 *   2. ⌘/Ctrl+K opens the command palette and Esc closes it.
 *   3. Every KPI card is reachable by keyboard (Tab focus traversal).
 *   4. Color contrast on KPI delta chips and Recent Activity amount cells
 *      meets WCAG 2.1 AA (≥ 4.5:1 for normal text) in both themes.
 *
 * Auth + seed for this spec are handled once by `dashboard-shell.setup.ts`,
 * which mints the workspace-owner cookie, signs the test user in, and
 * inserts a deterministic transaction set. The resulting cookies are
 * loaded here via the project's `storageState`.
 */

type Locale = "ar" | "en";
type Theme = "light" | "dark";

const COMBOS: { locale: Locale; theme: Theme }[] = [
  { locale: "en", theme: "light" },
  { locale: "en", theme: "dark" },
  { locale: "ar", theme: "light" },
  { locale: "ar", theme: "dark" },
];

async function gotoDashboard(page: Page, locale: Locale, theme: Theme) {
  // Pin the signed-in user's stored preferred locale to the variant under
  // test. Without this, `LocaleSync` (in
  // `client/src/components/layout/main-layout.tsx`) would read the user's
  // stored `preferredLocale` from `/api/auth/user` and call `setLocale()`
  // with it, overriding whatever we seed into `localStorage["app.locale"]`
  // below. Same workaround as `tests/e2e/topbar-profile.spec.ts` — see
  // task #152 for the full rationale.
  const profileRes = await page.request.patch("/api/auth/profile", {
    data: { preferredLocale: locale },
  });
  if (profileRes.status() !== 200) {
    throw new Error(
      `Failed to pin preferredLocale=${locale} on the dashboard test user: ` +
        `${profileRes.status()} ${await profileRes.text()}`,
    );
  }

  // Set locale + theme before the SPA mounts so the very first paint is correct.
  await page.addInitScript(
    ({ locale, theme }) => {
      window.localStorage.setItem("app.locale", locale);
      window.localStorage.setItem("app.theme", theme);
    },
    { locale, theme },
  );
  await page.goto("/app", { waitUntil: "networkidle" });
  await page
    .locator('[data-testid="kpi-strip"]')
    .waitFor({ state: "visible", timeout: 15_000 });
  // Give Recharts and skeleton swaps a beat to settle so screenshots don't tear.
  await page.waitForTimeout(800);
}

test.describe("dashboard shell", () => {
  // ---- 1. Visual snapshots for each locale × theme ----
  for (const { locale, theme } of COMBOS) {
    test(`visual snapshot — ${locale}-${theme}`, async ({ page }) => {
      await gotoDashboard(page, locale, theme);

      // Sanity-check that the shell actually applied locale + theme before
      // we burn cycles diffing pixels.
      const state = await page.evaluate(() => ({
        dir: document.documentElement.dir,
        lang: document.documentElement.lang,
        dark: document.documentElement.classList.contains("dark"),
      }));
      expect(state.dir).toBe(locale === "ar" ? "rtl" : "ltr");
      expect(state.lang).toBe(locale);
      expect(state.dark).toBe(theme === "dark");

      // Mask everything that legitimately varies between runs (seeded
      // numbers, dates, sparklines) so the snapshot only catches layout,
      // mirroring, and theme-token regressions.
      const masks = [
        page.locator("[data-testid='text-hero-cash']"),
        page.locator("[data-testid='kpi-strip'] .delta-chip"),
        page.locator("[data-testid='recent-activity'] tbody"),
        page.locator("svg.recharts-surface"),
        page.locator("[data-testid^='kpi-'] .tabular-nums"),
      ];

      await expect(page.locator("[data-testid='page-dashboard']")).toHaveScreenshot(
        `dashboard-${locale}-${theme}.png`,
        {
          mask: masks,
          maxDiffPixelRatio: 0.02,
          animations: "disabled",
          caret: "hide",
        },
      );
    });
  }

  // ---- 2. ⌘K opens / Esc closes the command palette ----
  test("command palette opens via ⌘/Ctrl+K and closes with Esc", async ({ page }) => {
    await gotoDashboard(page, "en", "light");

    const palette = page.locator("[data-testid='command-palette']");
    await expect(palette).toHaveCount(0);

    // ControlOrMeta picks the right modifier for the host OS so the in-app
    // handler (`metaKey || ctrlKey`) fires regardless of platform.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible();
    await expect(page.locator("[data-testid='input-command-search']")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
  });

  // ---- 3. Every KPI card is reachable by keyboard ----
  test("every KPI card is reachable by keyboard", async ({ page }) => {
    await gotoDashboard(page, "en", "light");

    // Find every KPI card (`<Link data-testid="kpi-...">`) currently rendered.
    // The strip can show 3 metric tiles + cash hero, or the empty-state hero.
    const kpiTestids = await page
      .locator("[data-testid^='kpi-']")
      .evaluateAll((els) =>
        els
          .filter((el) => el.tagName === "A" && (el as HTMLElement).offsetParent !== null)
          .map((el) => el.getAttribute("data-testid"))
          .filter((v): v is string => !!v),
      );
    expect(kpiTestids.length, "expected at least one KPI card to be rendered").toBeGreaterThan(0);

    // Walk Tab focus from the start of the page and collect every KPI card we hit.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    const reached = new Set<string>();
    const MAX_TABS = 80;
    for (let i = 0; i < MAX_TABS && reached.size < kpiTestids.length; i++) {
      await page.keyboard.press("Tab");
      const tid = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const node = el.closest("[data-testid^='kpi-']");
        return node?.getAttribute("data-testid") ?? null;
      });
      if (tid && kpiTestids.includes(tid)) reached.add(tid);
    }
    const missing = kpiTestids.filter((id) => !reached.has(id));
    expect(
      missing,
      `KPI cards not reachable via Tab traversal: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  // ---- 4. WCAG AA contrast on KPI deltas + Recent Activity amounts ----
  for (const theme of ["light", "dark"] as Theme[]) {
    test(`WCAG AA contrast on deltas and table rows — ${theme}`, async ({ page }) => {
      await gotoDashboard(page, "en", theme);

      // Compute the effective on-page contrast ratio for a locator's text
      // against the first opaque ancestor background. This collapses the
      // delta-chip's translucent tint onto the surrounding card so we score
      // the *rendered* contrast, not the spec'd one.
      const samples = await page.evaluate(() => {
        function parseColor(c: string): [number, number, number, number] {
          const m = c.match(/rgba?\(([^)]+)\)/);
          if (!m) return [0, 0, 0, 1];
          const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
          return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] ?? 1];
        }
        function blend(
          fg: [number, number, number, number],
          bg: [number, number, number],
        ): [number, number, number] {
          const a = fg[3];
          return [
            fg[0] * a + bg[0] * (1 - a),
            fg[1] * a + bg[1] * (1 - a),
            fg[2] * a + bg[2] * (1 - a),
          ];
        }
        function effectiveBg(el: Element): [number, number, number] {
          let cur: Element | null = el;
          let acc: [number, number, number, number] = [0, 0, 0, 0];
          while (cur) {
            const cs = getComputedStyle(cur);
            const c = parseColor(cs.backgroundColor);
            if (c[3] > 0) {
              const out: [number, number, number] = [
                acc[0] * acc[3] + c[0] * c[3] * (1 - acc[3]),
                acc[1] * acc[3] + c[1] * c[3] * (1 - acc[3]),
                acc[2] * acc[3] + c[2] * c[3] * (1 - acc[3]),
              ];
              const newA = acc[3] + c[3] * (1 - acc[3]);
              acc = [out[0] / (newA || 1), out[1] / (newA || 1), out[2] / (newA || 1), newA];
              if (acc[3] >= 0.999) return [acc[0], acc[1], acc[2]];
            }
            cur = cur.parentElement;
          }
          const pageBg = parseColor(getComputedStyle(document.body).backgroundColor);
          return blend([acc[0], acc[1], acc[2], acc[3]], [pageBg[0], pageBg[1], pageBg[2]]);
        }
        function relLum(rgb: [number, number, number]): number {
          const [r, g, b] = rgb.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        function contrast(fg: [number, number, number], bg: [number, number, number]): number {
          const L1 = relLum(fg);
          const L2 = relLum(bg);
          const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
          return (hi + 0.05) / (lo + 0.05);
        }

        const targets: { selector: string; label: string }[] = [
          { selector: "[data-testid='kpi-strip'] .delta-chip", label: "kpi-delta" },
          {
            selector:
              "[data-testid='recent-activity'] td.text-success, [data-testid='recent-activity'] td.text-destructive",
            label: "recent-amount",
          },
          { selector: "[data-testid^='row-recent-'] td", label: "recent-row-cell" },
        ];
        const results: { label: string; ratio: number; fg: string; bg: string }[] = [];
        for (const t of targets) {
          const nodes = Array.from(document.querySelectorAll(t.selector));
          for (const n of nodes) {
            const cs = getComputedStyle(n as Element);
            const fg = parseColor(cs.color);
            const bg = effectiveBg(n as Element);
            const fgBlended = blend(fg, bg);
            const ratio = contrast(fgBlended, bg);
            results.push({
              label: t.label,
              ratio: Math.round(ratio * 100) / 100,
              fg: cs.color,
              bg: `rgb(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])})`,
            });
          }
        }
        return results;
      });

      expect(
        samples.length,
        "expected to measure at least one delta or row cell",
      ).toBeGreaterThan(0);
      const failing = samples.filter((s) => s.ratio < 4.5);
      expect(
        failing,
        `Found ${failing.length} element(s) below WCAG AA 4.5:1 in ${theme} theme:\n` +
          failing.map((f) => `  • ${f.label}: ${f.ratio}:1 (fg=${f.fg} bg=${f.bg})`).join("\n"),
      ).toEqual([]);
    });
  }
});
