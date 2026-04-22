// ============================================================
// functions/api/dashboard/pedidos.js
// PANEL — elegance-panel
// GET   → listar pedidos con filtros (estado_pago, fechas)
// PATCH → aprobar o cancelar pedido
// ============================================================

// ── GET — Listar pedidos ───────────────────────────────────
export async function onRequestGet(context) {
  const { env, request } = context;
  const url         = new URL(request.url);
  const estado_pago = url.searchParams.get('estado_pago') || 'todos';
  const estado      = url.searchParams.get('estado')      || 'todos';
  const buscar      = url.searchParams.get('buscar')      || '';
  const desde       = url.searchParams.get('desde')       || '';
  const hasta       = url.searchParams.get('hasta')       || '';

  try {
    let where = 'WHERE p.archivado = 0';
    if (estado_pago !== 'todos') where += ` AND p.estado_pago = '${estado_pago}'`;
    if (estado      !== 'todos') where += ` AND p.estado = '${estado}'`;
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
      detalle:    JSON.parse(p.detalle    || '[]'),
      datos_pago: JSON.parse(p.datos_pago || '{}'),
    }));

    // Contadores por estado_pago para badges del panel
    const { results: contadores } = await env.elegance_db.prepare(`
      SELECT estado_pago, COUNT(*) AS n
      FROM pedidos WHERE archivado = 0
      GROUP BY estado_pago
    `).all();

    return Response.json({ success: true, pedidos, contadores });

  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── PATCH — Aprobar o Cancelar ─────────────────────────────
export async function onRequestPatch(context) {
  const { env, request } = context;

  try {
    const { id_pedido, accion, nuevo_estado } = await request.json();

    if (!id_pedido) {
      return Response.json({ success: false, error: 'id_pedido requerido' }, { status: 400 });
    }

    // ── APROBAR ─────────────────────────────────────────────
    if (accion === 'aprobar') {
      await env.elegance_db.prepare(`
        UPDATE pedidos
        SET estado_pago = 'aprobado',
            estado = 'Pendiente',
            aprobado_at = datetime('now')
        WHERE id_pedido = ?
      `).bind(id_pedido).run();

      return Response.json({ success: true, estado_pago: 'aprobado' });
    }

    // ── CANCELAR (devuelve stock) ────────────────────────────
    if (accion === 'cancelar') {
      const pedido = await env.elegance_db.prepare(
        "SELECT estado_pago FROM pedidos WHERE id_pedido = ?"
      ).bind(id_pedido).first();

      if (!pedido) {
        return Response.json({ success: false, error: 'Pedido no encontrado' }, { status: 404 });
      }

      // Obtener detalle para restaurar stock
      const { results: detalle } = await env.elegance_db.prepare(
        'SELECT id_producto, cantidad FROM detalle_pedidos WHERE id_pedido = ?'
      ).bind(id_pedido).all();

      const stmts = [];

      // Restaurar stock si el pedido estaba pendiente (el stock ya fue descontado)
      if (pedido.estado_pago === 'pendiente') {
        for (const item of detalle) {
          stmts.push(
            env.elegance_db.prepare(
              'UPDATE productos SET stock = stock + ? WHERE id = ?'
            ).bind(item.cantidad, item.id_producto)
          );
        }
      }

      // Cancelar pedido
      stmts.push(
        env.elegance_db.prepare(`
          UPDATE pedidos
          SET estado_pago = 'cancelado',
              estado = 'Cancelado',
              cancelado_at = datetime('now')
          WHERE id_pedido = ?
        `).bind(id_pedido)
      );

      await env.elegance_db.batch(stmts);
      return Response.json({ success: true, estado_pago: 'cancelado' });
    }

    // ── CAMBIO DE ESTADO NORMAL (Pendiente/Entregado) ────────
    if (nuevo_estado && ['Pendiente', 'Entregado', 'Cancelado'].includes(nuevo_estado)) {
      const pedido = await env.elegance_db.prepare(
        'SELECT estado, estado_pago FROM pedidos WHERE id_pedido = ?'
      ).bind(id_pedido).first();

      if (!pedido) {
        return Response.json({ success: false, error: 'Pedido no encontrado' }, { status: 404 });
      }

      const stmts = [];
      const estado_anterior = pedido.estado;

      // Ajuste de stock según cambio de estado
      let ajuste = 0;
      if (estado_anterior === 'Cancelado' && nuevo_estado !== 'Cancelado') ajuste = -1;
      if (estado_anterior !== 'Cancelado' && nuevo_estado === 'Cancelado')  ajuste = +1;

      if (ajuste !== 0) {
        const { results: detalle } = await env.elegance_db.prepare(
          'SELECT id_producto, cantidad FROM detalle_pedidos WHERE id_pedido = ?'
        ).bind(id_pedido).all();

        for (const item of detalle) {
          stmts.push(
            env.elegance_db.prepare(
              'UPDATE productos SET stock = stock + ? WHERE id = ?'
            ).bind(ajuste * item.cantidad, item.id_producto)
          );
        }
      }

      stmts.push(
        env.elegance_db.prepare(
          'UPDATE pedidos SET estado = ? WHERE id_pedido = ?'
        ).bind(nuevo_estado, id_pedido)
      );

      await env.elegance_db.batch(stmts);
      return Response.json({ success: true, estado: nuevo_estado });
    }

    return Response.json({ success: false, error: 'Acción no reconocida' }, { status: 400 });

  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}