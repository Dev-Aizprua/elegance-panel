// functions/api/dashboard/entregas.js
// Pedidos pendientes con indicador de urgencia
// FIX: días calculados en hora Panamá (UTC-5)

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const { results } = await env.elegance_db.prepare(`
      SELECT
        p.*,
        json_group_array(json_object(
          'nombre_producto', dp.nombre_producto,
          'cantidad',        dp.cantidad,
          'precio_final',    dp.precio_final
        )) AS detalle
      FROM pedidos p
      LEFT JOIN detalle_pedidos dp ON dp.id_pedido = p.id_pedido
      WHERE p.estado = 'Pendiente' AND p.archivado = 0
      GROUP BY p.id_pedido
      ORDER BY p.created_at ASC
    `).all();

    // Hora actual en Panamá (UTC-5)
    const ahoraUTC    = Date.now();
    const ahoraPanama = new Date(ahoraUTC - (5 * 60 * 60 * 1000));

    const entregas = results.map(p => {
      // created_at viene como "2026-04-17 13:54:11" (UTC del servidor)
      // Lo convertimos a hora Panamá restando 5 horas
      const creadoUTC    = new Date(p.created_at.replace(' ', 'T') + 'Z');
      const creadoPanama = new Date(creadoUTC.getTime() - (5 * 60 * 60 * 1000));

      // Días completos transcurridos en hora Panamá
      const hoyPanama   = new Date(ahoraPanama);
      hoyPanama.setHours(0, 0, 0, 0);
      const diaCreacion = new Date(creadoPanama);
      diaCreacion.setHours(0, 0, 0, 0);

      const dias = Math.floor((hoyPanama - diaCreacion) / (1000 * 60 * 60 * 24));

      return {
        ...p,
        detalle:        JSON.parse(p.detalle || '[]'),
        dias_pendiente: dias,
        urgente:        dias >= 3,
      };
    });

    return Response.json({ success: true, entregas });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}