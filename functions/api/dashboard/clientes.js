// functions/api/dashboard/clientes.js
// Top 5 VIP + base completa de clientes

export async function onRequestGet(context) {
  const { env, request } = context;
  const url    = new URL(request.url);
  const filtro = url.searchParams.get('filtro') || 'todo';
  const desde  = url.searchParams.get('desde')  || '';
  const hasta  = url.searchParams.get('hasta')  || '';

  try {
    let where = "WHERE p.estado != 'Cancelado'";
    const hoy = new Date();
    const pad = n => String(n).padStart(2,'0');
    const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

    if (filtro === 'hoy') {
      const f = fmtDate(hoy);
      where += ` AND substr(p.fecha,7,4)||'-'||substr(p.fecha,1,2)||'-'||substr(p.fecha,4,2) = '${f}'`;
    } else if (filtro === 'mes') {
      const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      where += ` AND substr(p.fecha,7,4)||'-'||substr(p.fecha,1,2)||'-'||substr(p.fecha,4,2) >= '${fmtDate(ini)}'`;
    } else if (filtro === 'anio') {
      where += ` AND substr(p.fecha,7,4) = '${hoy.getFullYear()}'`;
    } else if (filtro === 'rango' && desde && hasta) {
      where += ` AND substr(p.fecha,7,4)||'-'||substr(p.fecha,1,2)||'-'||substr(p.fecha,4,2) BETWEEN '${desde}' AND '${hasta}'`;
    }

    // Todos los clientes agrupados
    const { results: clientes } = await env.elegance_db.prepare(`
      SELECT
        cliente_nombre                        AS nombre,
        cliente_email                         AS email,
        cliente_tel                           AS telefono,
        direccion,
        COUNT(*)                              AS total_pedidos,
        ROUND(SUM(total), 2)                  AS total_gastado,
        MAX(fecha)                            AS ultimo_pedido
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