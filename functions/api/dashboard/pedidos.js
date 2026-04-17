// functions/api/dashboard/pedidos.js
// FIX: usa created_at en lugar de fecha para filtros de rango

export async function onRequestGet(context) {
  const { env, request } = context;
  const url    = new URL(request.url);
  const estado = url.searchParams.get('estado') || 'todos';
  const buscar = url.searchParams.get('buscar') || '';
  const desde  = url.searchParams.get('desde')  || '';
  const hasta  = url.searchParams.get('hasta')  || '';

  try {
    let where = "WHERE p.archivado = 0";
    if (estado !== 'todos') where += ` AND p.estado = '${estado}'`;
    if (buscar) where += ` AND (p.id_pedido LIKE '%${buscar}%' OR p.cliente_nombre LIKE '%${buscar}%')`;
    if (desde && hasta) {
      where += ` AND date(p.created_at) >= '${desde}' AND date(p.created_at) <= '${hasta}'`;
    }

    const { results } = await env.elegance_db.prepare(`
      SELECT p.*,
             json_group_array(json_object(
               'id_producto',     dp.id_producto,
               'nombre_producto', dp.nombre_producto,
               'cantidad',        dp.cantidad,
               'precio_base',     dp.precio_base,
               'itbms_pct',       dp.itbms_pct,
               'itbms_monto',     dp.itbms_monto,
               'precio_final',    dp.precio_final,
               'subtotal',        dp.subtotal
             )) AS detalle
      FROM pedidos p
      LEFT JOIN detalle_pedidos dp ON dp.id_pedido = p.id_pedido
      ${where}
      GROUP BY p.id_pedido
      ORDER BY p.created_at DESC
    `).all();

    const pedidos = results.map(p => ({
      ...p,
      detalle: JSON.parse(p.detalle || '[]'),
    }));

    return Response.json({ success: true, pedidos });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function onRequestPatch(context) {
  const { env, request } = context;

  try {
    const { id_pedido, nuevo_estado } = await request.json();
    if (!id_pedido || !nuevo_estado) {
      return Response.json({ success: false, error: 'Faltan datos' }, { status: 400 });
    }

    const estados_validos = ['Pendiente', 'Entregado', 'Cancelado'];
    if (!estados_validos.includes(nuevo_estado)) {
      return Response.json({ success: false, error: 'Estado inválido' }, { status: 400 });
    }

    const pedido = await env.elegance_db
      .prepare('SELECT estado FROM pedidos WHERE id_pedido = ?')
      .bind(id_pedido)
      .first();

    if (!pedido) {
      return Response.json({ success: false, error: 'Pedido no encontrado' }, { status: 404 });
    }

    const estado_anterior = pedido.estado;
    if (estado_anterior === nuevo_estado) {
      return Response.json({ success: true, mensaje: 'Sin cambios' });
    }

    const { results: detalle } = await env.elegance_db
      .prepare('SELECT id_producto, cantidad FROM detalle_pedidos WHERE id_pedido = ?')
      .bind(id_pedido)
      .all();

    const stmts = [];

    let ajuste = 0;
    if (estado_anterior === 'Cancelado' && nuevo_estado === 'Entregado')  ajuste = -1;
    if (estado_anterior === 'Cancelado' && nuevo_estado === 'Pendiente')  ajuste = -1;
    if (estado_anterior === 'Entregado' && nuevo_estado === 'Cancelado')  ajuste = +1;
    if (estado_anterior === 'Entregado' && nuevo_estado === 'Pendiente')  ajuste = +1;
    if (estado_anterior === 'Pendiente' && nuevo_estado === 'Cancelado')  ajuste = +1;

    if (ajuste !== 0) {
      for (const item of detalle) {
        stmts.push(
          env.elegance_db
            .prepare('UPDATE productos SET stock = stock + ? WHERE id = ?')
            .bind(ajuste * item.cantidad, item.id_producto)
        );
      }
    }

    stmts.push(
      env.elegance_db
        .prepare('UPDATE pedidos SET estado = ? WHERE id_pedido = ?')
        .bind(nuevo_estado, id_pedido)
    );

    await env.elegance_db.batch(stmts);

    return Response.json({ success: true, id_pedido, estado: nuevo_estado });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}