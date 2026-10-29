import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';

describe('LaserHouse Studio — Asistente de 6 Pasos e Interfaz (UI)', () => {
  it('renderiza la cabecera industrial, permite navegar por los 6 pasos y cambiar medidas con Undo/Redo', () => {
    render(<App />);

    expect(screen.getByText(/LASERHOUSE STUDIO/i)).toBeDefined();
    expect(screen.getByText(/Vank 9060 CO₂ \(900×600 mm\)/i)).toBeDefined();

    // Comprobar la barra de progreso de 6 pasos
    expect(screen.getByRole('button', { name: /1.*Logo/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /2.*Medidas/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /3.*Orificios/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /4.*Grabado/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /5.*Producción/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /6.*Exportar/i })).toBeDefined();

    // Ir al Paso 2: Medidas
    fireEvent.click(screen.getByRole('button', { name: /2.*Medidas/i }));
    expect(screen.getByText(/Medidas frecuentes de taller:/i)).toBeDefined();

    // Cambiar a preset 30 x 15 mm
    const preset30x15 = screen.getByRole('button', { name: '30 × 15 mm' });
    fireEvent.click(preset30x15);
    expect(screen.getByDisplayValue('30')).toBeDefined();
    expect(screen.getByDisplayValue('15')).toBeDefined();

    // Deshacer y Rehacer
    fireEvent.click(screen.getByTitle('Deshacer (Ctrl+Z)'));
    expect(screen.getByDisplayValue('20')).toBeDefined();
    expect(screen.getByDisplayValue('10')).toBeDefined();

    fireEvent.click(screen.getByTitle('Rehacer (Ctrl+Y)'));
    expect(screen.getByDisplayValue('30')).toBeDefined();
    expect(screen.getByDisplayValue('15')).toBeDefined();

    // Crear etiqueta nueva desde cero y verificar que inicia en blanco
    const newBtn = screen.getByTitle('Crear nueva etiqueta en blanco (sin agujeros por defecto)');
    fireEvent.click(newBtn);
    expect(screen.getByText(/Paso 1: Importar y Procesar Logotipo/i)).toBeDefined();
  });

  it('permite configurar orificios opcionales en el Paso 3 y cambiar recortes y cantidades en el Paso 5', () => {
    render(<App />);

    // Ir al Paso 3: Orificios
    fireEvent.click(screen.getByRole('button', { name: /3.*Orificios/i }));
    expect(screen.getByText(/¿La etiqueta lleva orificios\?/i)).toBeDefined();

    // Cambiar a 2 agujeros laterales
    const twoHolesBtn = screen.getByRole('button', { name: /2 Agujeros laterales/i });
    fireEvent.click(twoHolesBtn);
    expect(screen.getByText(/Diámetro \(mm\):/i)).toBeDefined();

    // Cambiar a Sin agujeros
    const noHolesBtn = screen.getByRole('button', { name: /Sin agujeros \(Lisa\)/i });
    fireEvent.click(noHolesBtn);
    expect(screen.getByText(/Etiqueta lisa sin orificios/i)).toBeDefined();

    // Ir al Paso 5: Producción
    fireEvent.click(screen.getByRole('button', { name: /5.*Producción/i }));
    expect(screen.getByText(/Material a procesar:/i)).toBeDefined();

    // Probar selección de recortes de material reales
    fireEvent.click(screen.getByRole('button', { name: /600 × 400 mm/i }));
    fireEvent.click(screen.getByRole('button', { name: /400 × 300 mm/i }));
    fireEvent.click(screen.getByRole('button', { name: /200 × 200 mm/i }));

    // Cambiar cantidad a 500 unidades
    fireEvent.click(screen.getByRole('button', { name: '500' }));
    expect(screen.getByText(/500 piezas/i)).toBeDefined();
  });

  it('ejecuta centrado exacto y ajuste de tamaño en Paso 4, y exporta archivos en Paso 6', () => {
    const createObjUrlMock = vi.fn(() => 'blob:mock-laserhouse-url');
    const revokeObjUrlMock = vi.fn();
    URL.createObjectURL = createObjUrlMock;
    URL.revokeObjectURL = revokeObjUrlMock;

    render(<App />);

    // Cargar logo de muestra en Paso 1
    fireEvent.click(screen.getByRole('button', { name: 'SVG Hexágono' }));

    // Ir al Paso 4: Grabado
    fireEvent.click(screen.getByRole('button', { name: /4.*Grabado/i }));
    expect(screen.getByText(/Centrado de Alta Precisión/i)).toBeDefined();

    // Ejecutar Centrar Logo y Ajustar al Espacio Disponible
    const centerBtn = screen.getByRole('button', { name: /CENTRAR LOGO/i });
    fireEvent.click(centerBtn);

    const fitBtn = screen.getByRole('button', { name: /AJUSTAR AL ESPACIO DISPONIBLE/i });
    fireEvent.click(fitBtn);

    // Ir al Paso 6: Exportar
    fireEvent.click(screen.getByRole('button', { name: /6.*Exportar/i }));
    expect(screen.getByText(/Auditoría de Validación Técnica/i)).toBeDefined();
    expect(screen.getByText(/Escala física 1:1 en milímetros verificada/i)).toBeDefined();

    // Ejecutar descargas
    const downloadSvgButtons = screen.getAllByRole('button', { name: /SVG/i });
    fireEvent.click(downloadSvgButtons[0]);

    const downloadDxfButtons = screen.getAllByRole('button', { name: /DXF R12/i });
    fireEvent.click(downloadDxfButtons[0]);

    const saveProjectButtons = screen.getAllByRole('button', { name: /Guardar \.lhstudio\.json/i });
    fireEvent.click(saveProjectButtons[0]);

    expect(createObjUrlMock).toHaveBeenCalled();
  });

  it('permite buscar pedidos en el catálogo y alternar estilos de visualización', () => {
    render(<App />);

    // Abrir modal de pedidos
    fireEvent.click(screen.getByRole('button', { name: /Pedidos/i }));
    expect(screen.getByPlaceholderText(/Buscar pedidos por cliente/i)).toBeDefined();

    // Filtrar por término
    const searchInput = screen.getByPlaceholderText(/Buscar pedidos por cliente/i);
    fireEvent.change(searchInput, { target: { value: 'Marroquinería' } });
    expect(screen.getByText(/Marroquinería Sur/i)).toBeDefined();

    // Limpiar búsqueda
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(screen.getByText(/Cliente Textil/i)).toBeDefined();

    // Cerrar modal
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    // Verificar botón de simulación de material
    expect(screen.getAllByText(/Simulación orientativa/i)[0]).toBeDefined();
  });
});
