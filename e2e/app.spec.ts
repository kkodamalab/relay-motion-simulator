import { test, expect } from "@playwright/test";
for (const width of [1440, 768, 375])
  test(
    "transport, exchange and responsive layout " + width,
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.setViewportSize({ width, height: 850 });
      await page.goto("./");
      await expect(page.locator("#clock")).toContainText("0.000");
      await page.getByRole("button", { name: "+1 frame", exact: true }).click();
      await expect(page.locator("#clock")).toContainText("0.008");
      await page.getByRole("button", { name: "−1 frame", exact: true }).click();
      await expect(page.locator("#clock")).toContainText("0.000");
      await page
        .getByRole("button", { name: "イベント時刻", exact: true })
        .click();
      await expect(page.locator("#result")).toContainText("成功");
      const clock = await page.locator("#clock").innerText();
      for (const rate of ["0.1×", "3×"]) {
        await page.getByRole("button", { name: rate, exact: true }).click();
        await expect(page.locator("#clock")).toHaveText(clock);
      }
      await page.locator("#play").click();
      await expect(page.locator("#clock")).not.toHaveText(clock);
      await page.locator("#play").click();
      const paused = await page.locator("#clock").innerText();
      await page.waitForTimeout(80);
      await expect(page.locator("#clock")).toHaveText(paused);
      await page.locator("#solo").click();
      await expect(page.locator("#editB")).toBeDisabled();
      await expect(page.locator("#result")).toContainText("単独走行");
      await page.locator("#reset").click();
      const download = page.waitForEvent("download");
      await page.locator("#csv").click();
      expect((await download).suggestedFilename()).toBe("relay-motion.csv");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    },
  );
