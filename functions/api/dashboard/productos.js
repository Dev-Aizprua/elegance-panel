// functions/api/dashboard/productos.js
// CRUD completo de productos para el panel

export async function onRequestGet(context) {
  const { env, request } = context;
  const url    = new URL(request.url);
  const buscar = url.searchParams.get('buscar') || '';

  try {
    let where = 'WHERE activo = 1';
    if (buscar) where += ` AND (nombre LIKE '%${buscar}%' OR id LIKE '%${buscar}%' OR categoria LIKE '%${buscar}%')`;

    const { results } = await env.elegance_db.prepare(`
      SELECT * FROM productos ${where} ORDER BY categoria, nombre
    `).all();

    return Response.json({ success: true, productos: results });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const d = await request.json();

    // Validaciones básicas
    if (!d.nombre || !d.precio_base) {
      return Response.json({ success: false, error: 'Nombre y precio son requeridos' }, { status: 400 });
    }
    if (d.nombre.length > 70) {
      return Response.json({ success: false, error: 'Nombre supera 70 caracteres' }, { status: 400 });
    }
    if (d.descripcion && d.descripcion.length > 100) {
      return Response.json({ success: false, error: 'Descripción supera 100 caracteres' }, { status: 400 });
    }

    // Generar ID automático si no viene
    let id = d.id;
    if (!id) {
      const prefix = 'EJ';
      const last = await env.elegance_db
        .prepare(`SELECT id FROM productos WHERE id LIKE '${prefix}%' ORDER BY id DESC LIMIT 1`)
        .first();
      if (last) {
        const num = parseInt(last.id.replace(prefix, '')) + 1;
        id = `${prefix}${String(num).padStart(3, '0')}`;
      } else {
        id = `${prefix}001`;
      }
    }

    await env.elegance_db.prepare(`
      INSERT INTO productos (id, nombre, descripcion, precio_base, costo, categoria, imagen_url, stock, itbms_pct, destacado, activo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(
      id,
      d.nombre,
      d.descripcion   || '',
      parseFloat(d.precio_base),
      parseFloat(d.costo || 0),
      d.categoria     || '',
      d.imagen_url    || '',
      parseInt(d.stock || 0),
      parseFloat(d.itbms_pct || 7),
      d.destacado ? 1 : 0,
    ).run();

    return Response.json({ success: true, id });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function onRequestPut(context) {
  const { env, request } = context;

  try {
    const d = await request.json();
    if (!d.id) return Response.json({ success: false, error: 'ID requerido' }, { status: 400 });

    if (d.nombre && d.nombre.length > 70) {
      return Response.json({ success: false, error: 'Nombre supera 70 caracteres' }, { status: 400 });
    }
    if (d.descripcion && d.descripcion.length > 100) {
      return Response.json({ success: false, error: 'Descripción supera 100 caracteres' }, { status: 400 });
    }

    await env.elegance_db.prepare(`
      UPDATE productos SET
        nombre      = ?,
        descripcion = ?,
        precio_base = ?,
        costo       = ?,
        categoria   = ?,
        imagen_url  = ?,
        stock       = ?,
        itbms_pct   = ?,
        destacado   = ?
      WHERE id = ?
    `).bind(
      d.nombre,
      d.descripcion || '',
      parseFloat(d.precio_base),
      parseFloat(d.costo || 0),
      d.categoria   || '',
      d.imagen_url  || '',
      parseInt(d.stock || 0),
      parseFloat(d.itbms_pct || 7),
      d.destacado ? 1 : 0,
      d.id,
    ).run();

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function onRequestDelete(context) {
  const { env, request } = context;

  try {
    const { id } = await request.json();
    if (!id) return Response.json({ success: false, error: 'ID requerido' }, { status: 400 });

    // Soft delete — marca inactivo para no romper histórico de pedidos
    await env.elegance_db
      .prepare('UPDATE productos SET activo = 0 WHERE id = ?')
      .bind(id)
      .run();

    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}