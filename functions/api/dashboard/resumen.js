// functions/api/dashboard/resumen.js
// KPIs principales con filtros de fecha
// FIX: usa created_at (YYYY-MM-DD) en lugar de fecha (M/D/YYYY sin ceros)

export async function onRequestGet(context) {
  const { env, request } = context;
  const url    = new URL(request.url);
  const filtro = url.searchParams.get('filtro') || 'todo';
  const desde  = url.searchParams.get('desde')  || '';
  const hasta  = url.searchParams.get('hasta')  || '';

  try {
    let where = "WHERE p.estado != 'Cancelado'";

    if (filtro === 'rango' && desde && hasta) {
      // El cliente manda YYYY-MM-DD — comparamos contra date(created_at) que es YYYY-MM-DD
      where += ` AND date(p.created_at) >= '${desde}' AND date(p.created_at) <= '${hasta}'`;
    }
    // 'todo' → sin filtro de fecha adicional

    // KPIs principales
    const kpis = await env.elegance_db.prepare(`
      SELECT
        COUNT(DISTINCT p.id_pedido)                                                AS total_pedidos,
        ROUND(SUM(p.total),    2)                                                   AS ventas_brutas,
        ROUND(SUM(p.subtotal), 2)                                                   AS ventas_netas,
        ROUND(SUM(p.itbms_total), 2)                                                AS itbms_total,
        ROUND(SUM(p.total) / NULLIF(COUNT(DISTINCT p.id_pedido), 0), 2)            AS ticket_promedio,
        SUM(dp.cantidad)                                                             AS unidades_vendidas,
        ROUND(SUM((dp.precio_base - IFNULL(pr.costo, 0)) * dp.cantidad), 2)        AS ganancia_total,
        ROUND(SUM(p.subtotal), 2)                                                   AS base_margen
      FROM pedidos p
      JOIN detalle_pedidos dp ON dp.id_pedido = p.id_pedido
      LEFT JOIN productos  pr ON pr.id        = dp.id_producto
      ${where}
    `).first();

    const margen = (kpis.base_margen > 0)
      ? Math.round((kpis.ganancia_total / kpis.base_margen) * 1000) / 10
      : 0;

    // Ventas por categoría
    const categorias = await env.elegance_db.prepare(`
      SELECT
        IFNULL(pr.categoria, 'Sin categoría') AS categoria,
        ROUND(SUM(dp.subtotal), 2)             AS total
      FROM detalle_pedidos dp
      JOIN pedidos p         ON p.id_pedido = dp.id_pedido
      LEFT JOIN productos pr ON pr.id       = dp.id_producto
      ${where}
      GROUP BY pr.categoria
      ORDER BY total DESC
    `).all();

    // Estado de pedidos — sin filtro de cancelados para esta gráfica
    const whereEstados = where === "WHERE p.estado != 'Cancelado'"
      ? 'WHERE 1=1'
      : 'WHERE 1=1' + where.replace("WHERE p.estado != 'Cancelado'", '');

    const estados = await env.elegance_db.prepare(`
      SELECT estado, COUNT(*) AS cantidad
      FROM pedidos p
      ${whereEstados}
      GROUP BY estado
    `).all();

    return Response.json({
      success: true,
      kpis: {
        total_pedidos:     kpis.total_pedidos     || 0,
        ventas_brutas:     kpis.ventas_brutas     || 0,
        ventas_netas:      kpis.ventas_netas      || 0,
        itbms_total:       kpis.itbms_total       || 0,
        ticket_promedio:   kpis.ticket_promedio   || 0,
        unidades_vendidas: kpis.unidades_vendidas || 0,
        ganancia_total:    kpis.ganancia_total    || 0,
        margen_promedio:   margen,
      },
      graficas: {
        categorias: categorias.results || [],
        estados:    estados.results    || [],
      },
    });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}