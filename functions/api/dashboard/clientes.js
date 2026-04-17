// functions/api/dashboard/clientes.js
// FIX: usa created_at en lugar de fecha

export async function onRequestGet(context) {
  const { env, request } = context;
  const url    = new URL(request.url);
  const filtro = url.searchParams.get('filtro') || 'todo';
  const desde  = url.searchParams.get('desde')  || '';
  const hasta  = url.searchParams.get('hasta')  || '';

  try {
    let where = "WHERE p.estado != 'Cancelado'";
    if (filtro === 'rango' && desde && hasta) {
      where += ` AND date(p.created_at) >= '${desde}' AND date(p.created_at) <= '${hasta}'`;
    }

    const { results: clientes } = await env.elegance_db.prepare(`
      SELECT
        cliente_nombre                       AS nombre,
        cliente_email                        AS email,
        cliente_tel                          AS telefono,
        direccion,
        COUNT(*)                             AS total_pedidos,
        ROUND(SUM(total), 2)                 AS total_gastado,
        MAX(fecha)                           AS ultimo_pedido
      FROM pedidos p
      ${where}
      GROUP BY cliente_email
      ORDER BY total_gastado DESC
    `).all();

    const top5 = clientes.slice(0, 5);

    return Response.json({ success: true, clientes, top5 });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}