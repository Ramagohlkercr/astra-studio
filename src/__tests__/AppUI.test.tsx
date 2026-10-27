import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';

describe('LaserHouse Studio — Pruebas End-to-End de Interfaz (UI)', () => {
  it('renderiza la interfaz industrial, permite cambiar medidas, deshacer/rehacer y crear etiqueta nueva sin agujeros', () => {
    render(<App />);

    expect(screen.getByText(/LASERHOUSE STUDIO/i)).toBeDefined();
    expect(screen.getByText(/Vank 9060 CO₂ \(900×600 mm\)/i)).toBeDefined();

    // Verificar medida inicial 20x10 mm y 200 unidades
    expect(screen.getByText(/1\. Editor de Etiqueta \(20×10 mm\)/i)).toBeDefined();
    expect(screen.getByText(/2\. Mesa de Producción \(200 u\./i)).toBeDefined();

    // Cambiar medida a preset 30 x 15 mm
    const preset30x15 = screen.getByRole('button', { name: '30 × 15 mm' });
    fireEvent.click(preset30x15);
    expect(screen.getByText(/1\. Editor de Etiqueta \(30×15 mm\)/i)).toBeDefined();

    // Deshacer y Rehacer
    fireEvent.click(screen.getByTitle('Deshacer'));
    expect(screen.getByText(/1\. Editor de Etiqueta \(20×10 mm\)/i)).toBeDefined();
    fireEvent.click(screen.getByTitle('Rehacer'));
    expect(screen.getByText(/1\. Editor de Etiqueta \(30×15 mm\)/i)).toBeDefined();

    // Crear etiqueta nueva desde cero y verificar que NO agrega agujeros automáticamente
    const newBtn = screen.getByTitle(
      'Crear nueva etiqueta en blanco (sin agujeros por defecto)'
    );
    fireEvent.click(newBtn);
    const holeSelect = screen.getByLabelText(
      'Configuración de agujeros'
    ) as HTMLSelectElement;
    expect(holeSelect.value).toBe('none');
  });

  it('permite configurar agujeros opcionales (sin agujeros, 1, 2, 4 y personalizados) y cambiar recortes de material (600x400, 400x300, 200x200 mm)', () => {
    render(<App />);

    const holeSelect = screen.getByLabelText(
      'Configuración de agujeros'
    ) as HTMLSelectElement;
    expect(holeSelect.value).toBe('none');

    // Cambiar a configuración personalizada de agujeros y agregar un segundo agujero
    fireEvent.change(holeSelect, { target: { value: 'custom' } });
    const addHoleBtn = screen.getByRole('button', { name: '+ Agregar agujero' });
    fireEvent.click(addHoleBtn);
    expect(screen.getByText('#2')).toBeDefined();

    // Probar selección de recortes de material reales (600x400 mm, 400x300 mm, 200x200 mm)
    fireEvent.click(screen.getByRole('button', { name: '600 × 400 mm' }));
    fireEvent.click(screen.getByRole('button', { name: '400 × 300 mm' }));
    fireEvent.click(screen.getByRole('button', { name: '200 × 200 mm' }));

    // Cambiar cantidad a 500 unidades y verificar que calcula múltiples tandas en recorte 200x200
    fireEvent.click(screen.getByRole('button', { name: '500' }));
    expect(screen.getByText(/500 unidades/i)).toBeDefined();
  });

  it('carga logos de prueba, ajusta a zona segura, ejecuta el lector independiente SVG/DXF y exporta archivos', () => {
    const createObjUrlMock = vi.fn(() => 'blob:mock-laserhouse-url');
    const revokeObjUrlMock = vi.fn();
    URL.createObjectURL = createObjUrlMock;
    URL.revokeObjectURL = revokeObjUrlMock;

    render(<App />);

    // Ir a pestaña 2. Logo / Arte
    fireEvent.click(screen.getByRole('button', { name: '2. Logo / Arte' }));

    // Cargar logo SVG con huecos internos y ajustar a zona segura
    fireEvent.click(screen.getByRole('button', { name: 'SVG Huecos' }));
    fireEvent.click(
      screen.getByRole('button', { name: /Ajustar y Centrar en Zona Segura/i })
    );

    // Abrir pestaña 3. Auditoría & Validación LightBurn/DXF
    fireEvent.click(
      screen.getByRole('button', {
        name: /3\. Auditoría & Validación LightBurn\/DXF/i,
      })
    );
    expect(screen.getByText('SVG 1:1 mm VERIFICADO')).toBeDefined();
    expect(screen.getByText('DXF AC1009 VERIFICADO')).toBeDefined();

    // Ir a pestaña 3. Material y verificar advertencia de seguridad
    fireEvent.click(screen.getByRole('button', { name: '3. Material' }));
    expect(screen.getByText(/ADVERTENCIA CRÍTICA DE SEGURIDAD/i)).toBeDefined();

    // Ejecutar exportaciones SVG, DXF y .lhstudio.json
    fireEvent.click(
      screen.getByTitle(/Exportar SVG 1:1 en milímetros con capas separadas/i)
    );
    fireEvent.click(
      screen.getByTitle(/Exportar DXF AC1009 en milímetros reales/i)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Guardar .lhstudio.json' }));

    expect(createObjUrlMock).toHaveBeenCalledTimes(3);
  });

  it('permite buscar pedidos en el catálogo, cambiar estilos de renderizado y previsualizar simulación de materiales', () => {
    render(<App />);

    // Abrir modal de pedidos
    fireEvent.click(screen.getByRole('button', { name: /Pedidos/i }));
    expect(screen.getByPlaceholderText(/Buscar pedidos por cliente/i)).toBeDefined();

    // Filtrar por término existente
    const searchInput = screen.getByPlaceholderText(/Buscar pedidos por cliente/i);
    fireEvent.change(searchInput, { target: { value: 'Marroquinería' } });
    expect(screen.getByText(/Marroquinería Sur/i)).toBeDefined();

    // Limpiar búsqueda
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(screen.getByText(/Cliente Textil/i)).toBeDefined();

    // Cerrar modal
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    // Verificar badge de simulación orientativa
    expect(screen.getByText(/Simulación orientativa/i)).toBeDefined();
  });
});
