// functions/api/dashboard/historicos.js
// FIX: usa created_at en lugar de fecha

export async function onRequestGet(context) {
  const { env, request } = context;
  const url    = new URL(request.url);
  const buscar = url.searchParams.get('buscar') || '';
  const anio   = url.searchParams.get('anio')   || '';

  try {
    // KPIs por año usando created_at
    const { results: kpisPorAnio } = await env.elegance_db.prepare(`
      SELECT
        strftime('%Y', p.created_at)                                               AS anio,
        COUNT(DISTINCT p.id_pedido)                                                AS total_pedidos,
        ROUND(SUM(p.total), 2)                                                     AS ventas_brutas,
        ROUND(SUM(p.subtotal), 2)                                                  AS ventas_netas,
        ROUND(SUM(p.total) / NULLIF(COUNT(DISTINCT p.id_pedido),0), 2)            AS ticket_promedio,
        ROUND(SUM((dp.precio_base - IFNULL(pr.costo,0)) * dp.cantidad), 2)        AS ganancia_total,
        ROUND(
          SUM((dp.precio_base - IFNULL(pr.costo,0)) * dp.cantidad) /
          NULLIF(SUM(p.subtotal),0) * 100
        , 1)                                                                       AS margen
      FROM pedidos p
      JOIN detalle_pedidos dp ON dp.id_pedido = p.id_pedido
      LEFT JOIN productos pr  ON pr.id        = dp.id_producto
      WHERE p.estado != 'Cancelado' AND p.archivado = 1
      GROUP BY anio
      ORDER BY anio DESC
    `).all();

    // Búsqueda en históricos
    let pedidosArch = [];
    if (buscar || anio) {
      let where = "WHERE p.archivado = 1";
      if (buscar) where += ` AND (p.id_pedido LIKE '%${buscar}%' OR p.cliente_nombre LIKE '%${buscar}%')`;
      if (anio)   where += ` AND strftime('%Y', p.created_at) = '${anio}'`;

      const { results } = await env.elegance_db.prepare(`
        SELECT p.*,
               json_group_array(json_object(
                 'nombre_producto', dp.nombre_producto,
                 'cantidad',        dp.cantidad,
                 'precio_final',    dp.precio_final
               )) AS detalle
        FROM pedidos p
        LEFT JOIN detalle_pedidos dp ON dp.id_pedido = p.id_pedido
        ${where}
        GROUP BY p.id_pedido
        ORDER BY p.created_at DESC
        LIMIT 100
      `).all();

      pedidosArch = results.map(p => ({
        ...p,
        detalle: JSON.parse(p.detalle || '[]'),
      }));
    }

    return Response.json({
      success:       true,
      kpis_por_anio: kpisPorAnio,
      pedidos:       pedidosArch,
    });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const { anio } = await request.json();
    const anioArchivar = anio || (new Date().getFullYear() - 1);

    const result = await env.elegance_db.prepare(`
      UPDATE pedidos SET archivado = 1
      WHERE strftime('%Y', created_at) = ? AND archivado = 0
    `).bind(String(anioArchivar)).run();

    const kpis = await env.elegance_db.prepare(`
      SELECT COUNT(*) AS total, ROUND(SUM(total),2) AS ventas
      FROM pedidos WHERE strftime('%Y', created_at) = ? AND estado != 'Cancelado'
    `).bind(String(anioArchivar)).first();

    await env.elegance_db.prepare(`
      INSERT INTO snapshots (fecha, total_pedidos, ventas_brutas, nota)
      VALUES (?, ?, ?, ?)
    `).bind(
      new Date().toISOString().split('T')[0],
      kpis.total  || 0,
      kpis.ventas || 0,
      `Cierre anual ${anioArchivar}`
    ).run();

    return Response.json({
      success:    true,
      archivados: result.meta?.changes || 0,
      anio:       anioArchivar,
    });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}