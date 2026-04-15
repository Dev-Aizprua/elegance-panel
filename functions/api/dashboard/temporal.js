// functions/api/dashboard/temporal.js
// Ventas diarias, ganancias y margen por día

export async function onRequestGet(context) {
  const { env, request } = context;
  const url    = new URL(request.url);
  const filtro = url.searchParams.get('filtro') || '7dias';
  const desde  = url.searchParams.get('desde')  || '';
  const hasta  = url.searchParams.get('hasta')  || '';

  try {
    const hoy = new Date();
    const pad = n => String(n).padStart(2,'0');
    const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

    let whereDate = '';
    if (filtro === 'hoy') {
      whereDate = `= '${fmtDate(hoy)}'`;
    } else if (filtro === '7dias') {
      const ini = new Date(hoy); ini.setDate(hoy.getDate() - 6);
      whereDate = `>= '${fmtDate(ini)}'`;
    } else if (filtro === 'rango' && desde && hasta) {
      whereDate = `BETWEEN '${desde}' AND '${hasta}'`;
    } else {
      const ini = new Date(hoy); ini.setDate(hoy.getDate() - 6);
      whereDate = `>= '${fmtDate(ini)}'`;
    }

    const { results } = await env.elegance_db.prepare(`
      SELECT
        substr(p.fecha,7,4)||'-'||substr(p.fecha,1,2)||'-'||substr(p.fecha,4,2) AS fecha_iso,
        p.fecha                                                                   AS fecha_display,
        COUNT(DISTINCT p.id_pedido)                                               AS total_pedidos,
        ROUND(SUM(p.total), 2)                                                    AS ventas_brutas,
        ROUND(SUM(p.subtotal), 2)                                                 AS ventas_netas,
        ROUND(SUM((dp.precio_base - IFNULL(pr.costo,0)) * dp.cantidad), 2)        AS ganancia,
        ROUND(
          SUM((dp.precio_base - IFNULL(pr.costo,0)) * dp.cantidad) /
          NULLIF(SUM(p.subtotal), 0) * 100
        , 1)                                                                      AS margen
      FROM pedidos p
      JOIN detalle_pedidos dp ON dp.id_pedido = p.id_pedido
      LEFT JOIN productos pr  ON pr.id = dp.id_producto
      WHERE p.estado != 'Cancelado'
        AND substr(p.fecha,7,4)||'-'||substr(p.fecha,1,2)||'-'||substr(p.fecha,4,2) ${whereDate}
      GROUP BY fecha_iso
      ORDER BY fecha_iso ASC
    `).all();

    return Response.json({ success: true, dias: results });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}