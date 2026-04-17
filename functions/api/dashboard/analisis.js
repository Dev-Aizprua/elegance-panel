// functions/api/dashboard/analisis.js
// FIX: usa created_at en lugar de fecha

export async function onRequestGet(context) {
  const { env, request } = context;
  const url    = new URL(request.url);
  const filtro = url.searchParams.get('filtro') || 'todo';
  const desde  = url.searchParams.get('desde')  || '';
  const hasta  = url.searchParams.get('hasta')  || '';

  try {
    let wherePedidos = "WHERE p.estado != 'Cancelado'";
    if (filtro === 'rango' && desde && hasta) {
      wherePedidos += ` AND date(p.created_at) >= '${desde}' AND date(p.created_at) <= '${hasta}'`;
    }

    // Top 5 productos más vendidos
    const { results: top5 } = await env.elegance_db.prepare(`
      SELECT
        dp.id_producto,
        dp.nombre_producto,
        SUM(dp.cantidad)          AS unidades,
        ROUND(SUM(dp.subtotal),2) AS ingresos
      FROM detalle_pedidos dp
      JOIN pedidos p ON p.id_pedido = dp.id_pedido
      ${wherePedidos}
      GROUP BY dp.id_producto
      ORDER BY unidades DESC
      LIMIT 5
    `).all();

    // Stock crítico y bajo — sin filtro de fecha
    const { results: stock } = await env.elegance_db.prepare(`
      SELECT id, nombre, categoria, stock,
        CASE
          WHEN stock <= 2 THEN 'CRITICO'
          WHEN stock <= 4 THEN 'BAJO'
          ELSE 'OK'
        END AS nivel
      FROM productos
      WHERE activo = 1 AND stock <= 4
      ORDER BY stock ASC
    `).all();

    // Ventas por categoría
    const { results: categorias } = await env.elegance_db.prepare(`
      SELECT
        IFNULL(pr.categoria, 'Sin categoría') AS categoria,
        SUM(dp.cantidad)                       AS unidades,
        ROUND(SUM(dp.subtotal), 2)             AS ingresos
      FROM detalle_pedidos dp
      JOIN pedidos p         ON p.id_pedido = dp.id_pedido
      LEFT JOIN productos pr ON pr.id       = dp.id_producto
      ${wherePedidos}
      GROUP BY pr.categoria
      ORDER BY ingresos DESC
    `).all();

    const totalIngresos = categorias.reduce((s, c) => s + c.ingresos, 0);
    const categoriasConPct = categorias.map(c => ({
      ...c,
      porcentaje: totalIngresos > 0
        ? Math.round((c.ingresos / totalIngresos) * 1000) / 10
        : 0,
    }));

    return Response.json({
      success:        true,
      top5_productos: top5,
      stock_alertas:  stock,
      categorias:     categoriasConPct,
    });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}