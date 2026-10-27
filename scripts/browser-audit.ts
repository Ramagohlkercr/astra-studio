import { chromium } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const outDir = '/Users/ramirogohlke/.gemini/antigravity/brain/b530517b-7153-47a7-9a31-382b6816c1f7/scratch/screenshots_before';
fs.mkdirSync(outDir, { recursive: true });

async function runAudit() {
  const browser = await chromium.launch({
    executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    headless: true,
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  // 1. Editor View (Forma / mm)
  await page.screenshot({ path: path.join(outDir, 'audit_01_editor.png') });

  // 2. Left Tab: 2. Logo / Arte
  await page.getByRole('button', { name: '2. Logo / Arte' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, 'audit_02_logo_tab.png') });

  // Test loading PNG with white background to see raster controls
  await page.getByRole('button', { name: 'PNG F. Blanco' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'audit_02b_raster_controls.png') });

  // 3. Left Tab: 3. Material
  await page.getByRole('button', { name: '3. Material' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, 'audit_03_material_tab.png') });

  // 4. Production Bed View
  await page.getByRole('button', { name: /2\. Mesa de Producción/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'audit_04_production_bed.png') });

  // 5. Inspector View
  await page.getByRole('button', { name: /3\. Auditoría & Validación/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'audit_05_inspector.png') });

  // 6. Orders Modal
  await page.getByTitle(/Abrir catálogo de pedidos/i).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, 'audit_06_orders_modal.png') });

  await browser.close();
  console.log('Screenshots saved to:', outDir);
  console.log('Console errors:', consoleErrors);
}

runAudit().catch((err) => {
  console.error(err);
  process.exit(1);
});
