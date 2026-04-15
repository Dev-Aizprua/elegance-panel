// functions/api/dashboard/entregas.js
// Pedidos pendientes ordenados por antigüedad con indicador de urgencia

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

    // Calcular días pendiente y nivel de urgencia
    const hoy = new Date();
    const entregas = results.map(p => {
      const creado  = new Date(p.created_at);
      const dias    = Math.floor((hoy - creado) / (1000 * 60 * 60 * 24));
      return {
        ...p,
        detalle:  JSON.parse(p.detalle || '[]'),
        dias_pendiente: dias,
        urgente:  dias >= 3,
      };
    });

    return Response.json({ success: true, entregas });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}