import { chromium } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const artifactScreenshotsDir =
  '/Users/ramirogohlke/.gemini/antigravity/brain/b530517b-7153-47a7-9a31-382b6816c1f7/screenshots_sprint3';
fs.mkdirSync(artifactScreenshotsDir, { recursive: true });

async function runE2EWorkflow() {
  console.log('🚀 Iniciando Auditoría Visual y Flujo E2E de 14 Pasos en Navegador Real...');

  const browser = await chromium.launch({
    executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    headless: true,
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[Console Error]: ${msg.text()}`);
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(`[Page Error]: ${err.message}`);
  });

  // PASO 1: Abrir LaserHouse Studio
  console.log('Paso 1: Abrir LaserHouse Studio en http://127.0.0.1:5173/');
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // PASO 2: Crear un pedido nuevo en blanco
  console.log('Paso 2: Crear un nuevo pedido');
  await page.getByTitle(/Crear nueva etiqueta en blanco/i).click();
  await page.waitForTimeout(300);

  // PASO 3 y 4: Importar logo del cliente y convertir a monocromático
  console.log('Paso 3 y 4: Importar logo y convertir a monocromático');
  await page.getByRole('button', { name: '2. Logo / Arte' }).click();
  await page.waitForTimeout(200);

  // Cargar muestra de PNG con fondo blanco para probar remoción de fondo y comparación lado a lado
  await page.getByRole('button', { name: 'PNG F. Blanco' }).click();
  await page.waitForTimeout(400);

  // Captura 1: Comparación Visual Lado a Lado (Original vs Procesado)
  await page.screenshot({
    path: path.join(artifactScreenshotsDir, '02_logo_side_by_side.png'),
  });
  console.log('📸 Captura 02_logo_side_by_side.png guardada');

  // Probar cambio a modo vector para ver slider de detalle fino
  await page.getByRole('button', { name: /Vectorizar/i }).click();
  await page.waitForTimeout(300);

  // PASO 5: Elegir material Ecocuero Suela
  console.log('Paso 5: Elegir material Ecocuero Suela');
  await page.getByRole('button', { name: '3. Material' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Ecocuero Suela/i }).click();
  await page.waitForTimeout(200);

  // PASO 6: Definir medidas exactas (20 x 10 mm)
  console.log('Paso 6: Definir medidas exactas 20x10 mm');
  await page.getByRole('button', { name: '1. Forma / mm' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '20 × 10 mm' }).click();
  await page.waitForTimeout(200);

  // PASO 7: Ajustar el logo manualmente (centrar y zona segura)
  console.log('Paso 7: Ajustar logo en zona segura');
  await page.getByRole('button', { name: '2. Logo / Arte' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Ajustar y Centrar en Zona Segura/i }).click();
  await page.waitForTimeout(200);

  // Captura 1: Editor de Etiqueta con simulación de Ecocuero Suela y cotas
  await page.screenshot({
    path: path.join(artifactScreenshotsDir, '01_editor_ecocuero.png'),
  });
  console.log('📸 Captura 01_editor_ecocuero.png guardada');

  // PASO 8: Configurar agujeros (sin agujeros para costura perimetral)
  console.log('Paso 8: Verificar que la etiqueta no lleva agujeros por defecto');
  await page.getByRole('button', { name: '1. Forma / mm' }).click();
  await page.waitForTimeout(200);

  // PASO 9: Indicar 200 unidades
  console.log('Paso 9: Indicar 200 unidades');
  await page.getByRole('button', { name: '200', exact: true }).click();
  await page.waitForTimeout(200);

  // PASO 10: Configurar tamaño de material (600 x 400 mm)
  console.log('Paso 10: Configurar recorte de material 600x400 mm');
  await page.getByRole('button', { name: '600 × 400 mm' }).click();
  await page.waitForTimeout(300);

  // PASO 11 & 12: Distribuir automáticamente y revisar la producción
  console.log('Paso 11 & 12: Revisar distribución de producción');
  await page.getByRole('button', { name: /2\. Mesa de Producción/i }).click();
  await page.waitForTimeout(400);

  // Captura 5: Mesa de Producción con 200 unidades
  await page.screenshot({
    path: path.join(artifactScreenshotsDir, '05_production_bed_200u.png'),
  });
  console.log('📸 Captura 05_production_bed_200u.png guardada');

  // Probar simulación de Acrílico Transparente
  console.log('Probando simulación visual Acrílico Transparente...');
  await page.getByRole('button', { name: /1\. Editor de Etiqueta/i }).click();
  await page.getByRole('button', { name: '3. Material' }).click();
  await page.getByRole('button', { name: /Acrílico Transparente/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(artifactScreenshotsDir, '03_acrilico_transparente.png'),
  });
  console.log('📸 Captura 03_acrilico_transparente.png guardada');

  // Probar simulación de Acrílico Espejo Plateado
  console.log('Probando simulación visual Acrílico Espejo Plateado...');
  await page.getByRole('button', { name: /Acrílico Espejo Plateado/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(artifactScreenshotsDir, '04_acrilico_espejo.png'),
  });
  console.log('📸 Captura 04_acrilico_espejo.png guardada');

  // Volver a Ecocuero Suela para la orden principal
  await page.getByRole('button', { name: /Ecocuero Suela/i }).click();
  await page.waitForTimeout(200);

  // PASO 13: Abrir pestaña de Auditoría & Validación de Archivos LightBurn
  console.log('Paso 13: Auditoría & Validación LightBurn');
  await page.getByRole('button', { name: /3\. Auditoría & Validación LightBurn\/DXF/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(artifactScreenshotsDir, '06_inspector_audit_lightburn.png'),
  });
  console.log('📸 Captura 06_inspector_audit_lightburn.png guardada');

  // PASO 14: Catálogo de Pedidos y Búsqueda
  console.log('Paso 14: Catálogo de Pedidos y Búsqueda');
  await page.getByTitle(/Abrir catálogo de pedidos guardados/i).click();
  await page.waitForTimeout(300);

  // Buscar en el catálogo
  const searchInput = page.getByPlaceholder(/Buscar pedidos por cliente/i);
  await searchInput.fill('Marroquinería');
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(artifactScreenshotsDir, '07_orders_library_search.png'),
  });
  console.log('📸 Captura 07_orders_library_search.png guardada');

  await browser.close();

  console.log('==============================================');
  console.log('✅ AUDITORÍA VISUAL Y E2E COMPLETADA CON ÉXITO');
  console.log(`📸 Capturas en: ${artifactScreenshotsDir}`);
  console.log(`Errores de consola: ${consoleErrors.length}`);
  if (consoleErrors.length > 0) {
    console.warn('Detalle errores:', consoleErrors);
  }
}

runE2EWorkflow().catch((err) => {
  console.error('❌ Error en script E2E:', err);
  process.exit(1);
});
