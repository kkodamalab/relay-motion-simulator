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

test("seek, export and manual loop without an exchange", async ({ page }) => {
  await page.goto("./");
  await page.locator("#solo").click();
  await expect(page.locator("#lo")).toHaveValue("");
  await page.locator("#lo").fill("1.2");
  await page.locator("#hi").fill("1.4");
  await page.locator("#ab").check();
  await page.locator("#play").click();
  await page.waitForTimeout(400);
  await page.locator("#play").click();
  const time = parseFloat(await page.locator("#clock").innerText());
  expect(time).toBeGreaterThanOrEqual(1.2);
  expect(time).toBeLessThanOrEqual(1.4);
  await page.locator("#reset").click();
  await page.locator("#timeline").focus();
  await page.keyboard.press("End");
  await expect(page.locator("#clock")).toContainText("6.000");
  await expect(page.locator("#stats")).toContainText("48.00 m");
  await expect(page.locator("#result")).toContainText("保持 B");
});

test("research plots, screenshots and identical CSV/JSON samples", async ({
  page,
}, info) => {
  await page.goto("./");
  await page.setViewportSize({ width: 1200, height: 880 });
  const seek = async (v: number) => {
    await page.locator("#timeline").evaluate((el: HTMLInputElement, t) => {
      el.value = String(t);
      el.dispatchEvent(new Event("input"));
    }, v);
  };
  await page.locator("#trace00").check();
  for (const [label, time] of [
    ["before-contact", 0.99],
    ["after-contact", 1.01],
    ["receiver", 1.86],
  ] as const) {
    await seek(time);
    await page
      .locator(".stage")
      .screenshot({ path: info.outputPath(label + ".png") });
  }
  await page.locator("#baton").uncheck();
  await expect(page.locator("#result")).not.toContainText("保持");
  await page.getByRole("button", { name: "PHASE", exact: true }).click();
  await page.locator("#phaseScope").selectOption("2");
  await page.locator("#phaseSource").selectOption("1");
  for (const mode of ["0", "1", "2", "3", "4"]) {
    await page.locator("#phaseChart").selectOption(mode);
    await expect(page.locator("#legend")).toContainText("A左脚");
  }
  await page.locator("#space").selectOption({ label: "BODY RELATIVE" });
  await page.locator("#trace01").check();
  await page.locator("#coords").check();
  await expect(page.locator("#coordinates")).toContainText("左手");
  const read = async (id: string) => {
    const ready = page.waitForEvent("download");
    await page.locator("#" + id).click();
    const stream = await (await ready).createReadStream();
    const chunks = [];
    for await (const part of stream!) chunks.push(part);
    return Buffer.concat(chunks).toString("utf8");
  };
  const json = JSON.parse(await read("json")),
    csv = (await read("csv")).trim().split(/\r?\n/),
    keys = csv[0].replace(/^\uFEFF/, "").split(",");
  expect(csv.length).toBe(723 - 1);
  for (const n of [0, 120, 720]) {
    const fields = csv[n + 1].split(",");
    keys.forEach((k, i) => expect(fields[i]).toBe(String(json.samples[n][k])));
  }
  expect(keys).not.toContain("owner");
});
